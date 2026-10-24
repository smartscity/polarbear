"""Local-only model screening. Run separately per engine; never downloads assets."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import struct
import subprocess
import time

import numpy as np
import soundfile as sf
from metrics import score
from prepare import MODELS, STREAMING_COMPONENTS, verify_model


def inference_threads(available=None):
    # Match the production helper's budget; keep historic fixed-four evidence separate.
    available = os.cpu_count() if available is None else available
    return min(4, max(1, (available or 1) - 1))


class WhisperBaseline:
    def __init__(self, executable, model, threads):
        self.threads = threads
        self.process = subprocess.Popen([str(executable), str(model), str(threads)], env={},
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        try:
            ready = json.loads(self.process.stdout.readline())
            if ready.get("threads") != threads:
                raise ValueError("Baseline thread budget mismatch")
            self.load_seconds = ready["loadSeconds"]
        except BaseException:
            self.close()
            raise

    def transcribe(self, samples):
        self.process.stdin.write(struct.pack("<I", len(samples)) + samples.astype("<f4").tobytes())
        self.process.stdin.flush()
        return json.loads(self.process.stdout.readline())

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.process.stdout.close()


class SherpaCandidate:
    def __init__(self, kind, directory, threads):
        import sherpa_onnx
        for filename in MODELS[kind]["files"]:
            verify_model(kind, directory / filename)
        self.kind = kind
        self.threads = threads
        self.version = sherpa_onnx.__version__
        start = time.perf_counter()
        if kind == "parakeet":
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
                encoder=str(directory / "encoder.int8.onnx"),
                decoder=str(directory / "decoder.int8.onnx"),
                joiner=str(directory / "joiner.int8.onnx"), tokens=str(directory / "tokens.txt"),
                num_threads=threads, feature_dim=128, model_type="nemo_transducer", provider="cpu")
        else:
            components = STREAMING_COMPONENTS[kind]
            self.recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
                **{part: str(directory / filename) for part, filename in components.items()},
                tokens=str(directory / "tokens.txt"), num_threads=threads,
                enable_endpoint_detection=False, provider="cpu")
        self.load_seconds = time.perf_counter() - start

    def transcribe(self, samples):
        start = time.perf_counter()
        stream = self.recognizer.create_stream()
        if self.kind == "parakeet":
            stream.accept_waveform(16000, samples)
            self.recognizer.decode_stream(stream)
            text = stream.result.text
        else:
            for offset in range(0, len(samples), 1280):
                stream.accept_waveform(16000, samples[offset:offset + 1280])
                while self.recognizer.is_ready(stream):
                    self.recognizer.decode_stream(stream)
            # Match the pinned publisher's online-decode-files.py EOF lookahead.
            stream.accept_waveform(16000, np.zeros(10560, dtype=np.float32))
            stream.input_finished()
            while self.recognizer.is_ready(stream):
                self.recognizer.decode_stream(stream)
            text = self.recognizer.get_result(stream)
        return {"text": text, "decodeSeconds": time.perf_counter() - start}

    def close(self):
        pass

    def paced_probe(self, samples):
        if self.kind == "parakeet":
            raise ValueError("The selected Parakeet model is not a native streaming model")
        stream = self.recognizer.create_stream()
        started = time.perf_counter()
        events = []
        previous = ""
        # Deliver 80 ms of audio at wall-clock speed, without replaying prefixes.
        for start in range(0, len(samples), 1280):
            chunk = samples[start:start + 1280]
            arrival = (start + len(chunk)) / 16000
            time.sleep(max(0, started + arrival - time.perf_counter()))
            stream.accept_waveform(16000, chunk)
            while self.recognizer.is_ready(stream):
                self.recognizer.decode_stream(stream)
            text = self.recognizer.get_result(stream)
            if text != previous:
                events.append({"audioSeconds": arrival, "wallSeconds": time.perf_counter() - started,
                               "text": text})
                previous = text
        stream.accept_waveform(16000, np.zeros(10560, dtype=np.float32))
        stream.input_finished()
        while self.recognizer.is_ready(stream):
            self.recognizer.decode_stream(stream)
        elapsed = time.perf_counter() - started
        return {"audioSeconds": len(samples) / 16000, "wallSeconds": elapsed,
                "finalizationAfterEofSeconds": elapsed - len(samples) / 16000,
                "text": self.recognizer.get_result(stream), "updates": events}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", choices=("whisper", *MODELS))
    parser.add_argument("directory", type=Path)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--whisper-model", type=Path)
    parser.add_argument("--paced", action="store_true")
    parser.add_argument("--threads", type=int, choices=range(1, 17), default=inference_threads())
    args = parser.parse_args()
    if args.paced and args.engine not in STREAMING_COMPONENTS:
        parser.error("--paced requires a native streaming candidate")
    cases = json.loads((args.directory / "samples/samples.json").read_text())
    if len(cases) != 20:
        raise ValueError("The predeclared 20-sample corpus must be complete")
    engine = (WhisperBaseline(args.baseline, args.whisper_model, args.threads) if args.engine == "whisper"
              else SherpaCandidate(args.engine, args.directory / "models" / args.engine, args.threads))
    report = {"engine": args.engine, "machine": platform.machine(), "platform": platform.platform(),
              "threads": engine.threads, "availableCpus": os.cpu_count(), "provider": "cpu", "loadSeconds": engine.load_seconds,
              "runtimeVersion": getattr(engine, "version", "pinned whisper.cpp v1.9.5"),
              "scoring": "lowercase, punctuation removed, apostrophes retained; no number expansion",
              "records": []}
    output = args.directory / f"{args.engine}-results.json"
    try:
        for condition in ("clean", "white-noise-10db"):
            for case in cases:
                path = args.directory / "samples" / case["file"]
                if hashlib.sha256(path.read_bytes()).hexdigest() != case["sha256"]:
                    raise ValueError(f"Sample checksum changed: {case['id']}")
                samples, rate = sf.read(path, dtype="float32")
                if rate != 16000 or samples.ndim != 1 or len(samples) > 16000 * 60:
                    raise ValueError("Expected mono 16 kHz audio, at most 60 seconds")
                if condition != "clean":
                    rng = np.random.default_rng(case["index"] + 20261017)
                    noise = rng.standard_normal(samples.shape).astype(np.float32)
                    noise *= np.sqrt(np.mean(samples ** 2) / (10 * np.mean(noise ** 2)))
                    samples = np.clip(samples + noise, -1, 1)
                result = engine.transcribe(samples)
                record = {"id": case["id"], "speaker": case["speaker"], "condition": condition,
                          "audioSeconds": len(samples) / rate, "reference": case["reference"],
                          **result, **score(case["reference"], result["text"])}
                report["records"].append(record)
                output.write_text(json.dumps(report, indent=2) + "\n")
                print(json.dumps({key: record[key] for key in
                                  ("id", "condition", "audioSeconds", "decodeSeconds", "wer")}), flush=True)
        silence = engine.transcribe(np.zeros(16000 * 5, dtype=np.float32))
        report["silence"] = silence
        if args.paced:
            report["pacedProbes"] = []
            for case in (cases[0], cases[1], cases[5]):
                samples, _ = sf.read(args.directory / "samples" / case["file"], dtype="float32")
                report["pacedProbes"].append({"id": case["id"], **engine.paced_probe(samples)})
        report["peakRssBytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        report["rssScope"] = "Python parent only; excludes Whisper subprocess" if args.engine == "whisper" else "Python plus native runtime"
        report["summary"] = {}
        for condition in ("clean", "white-noise-10db"):
            records = [r for r in report["records"] if r["condition"] == condition]
            audio = sum(r["audioSeconds"] for r in records)
            decode = sum(r["decodeSeconds"] for r in records)
            reference_words = sum(r["referenceWords"] for r in records)
            report["summary"][condition] = {
                "clips": len(records), "speakers": len({r["speaker"] for r in records}),
                "audioSeconds": audio, "decodeSeconds": decode, "rtf": decode / audio,
                "referenceWords": reference_words,
                "wer": sum(r["edits"] for r in records) / reference_words}
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report["summary"], indent=2), flush=True)
    finally:
        engine.close()


if __name__ == "__main__":
    main()
