"""Offline accuracy and bounded, wall-clock prefix-replay qualification."""

import argparse
import ast
from collections import defaultdict
from itertools import zip_longest
import json
import multiprocessing as mp
import os
from pathlib import Path
import platform
import queue
import signal
import socket
import subprocess
import time
import traceback

import numpy as np
import soundfile as sf

from evaluate import SherpaCandidate, WhisperBaseline
from metrics import score, words as normalize
from qualification_corpus import CALLS, MEETINGS, digest
from prepare import MODEL_SHA256
from process_memory import ProcessMemory

TIMEOUT = 60
QUEUE_LIMIT = 2


def worker(config, requests, replies):
    os.setsid()
    engine = None
    try:
        engine = (WhisperBaseline(config["baseline"], config["whisper_model"])
                  if config["engine"] == "whisper" else
                  SherpaCandidate("parakeet", Path(config["models"]) / "parakeet"))
        replies.put({"ready": True, "loadSeconds": engine.load_seconds})
        while True:
            job = requests.get()
            if job is None:
                break
            identity, samples = job
            began = time.monotonic()
            result = engine.transcribe(samples)
            replies.put({"id": identity, "started": began, "finished": time.monotonic(), **result})
    except BaseException:
        replies.put({"error": traceback.format_exc()})
    finally:
        if engine:
            engine.close()


class EngineWorker:
    def __init__(self, config):
        context = mp.get_context("spawn")
        self.requests = context.Queue(maxsize=QUEUE_LIMIT)
        self.replies = context.Queue()
        self.process = context.Process(target=worker, args=(config, self.requests, self.replies))
        self.process.start()
        try:
            self.ready = self.receive(TIMEOUT)
            if not self.ready.get("ready"):
                raise RuntimeError("Engine did not acknowledge startup")
        except BaseException:
            self.close()
            raise

    def receive(self, timeout=0):
        try:
            result = self.replies.get(timeout=timeout)
        except queue.Empty:
            if not self.process.is_alive():
                raise RuntimeError(f"Engine process exited: {self.process.exitcode}")
            if timeout:
                raise TimeoutError("Engine response exceeded timeout")
            return None
        if "error" in result:
            raise RuntimeError(result["error"])
        return result

    def close(self):
        try:
            self.requests.put_nowait(None)
        except queue.Full:
            pass
        self.process.join(timeout=5)
        if self.process.is_alive():
            # The child owns its process group, including the Whisper subprocess.
            try:
                if os.getpgid(self.process.pid) == self.process.pid:
                    os.killpg(self.process.pid, signal.SIGKILL)
                else:
                    self.process.kill()
            except ProcessLookupError:
                pass
            self.process.join(timeout=5)
        # Reap a native child even if its Python owner crashed first.
        try:
            os.killpg(self.process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        self.requests.cancel_join_thread()
        self.requests.close()
        self.replies.close()


def offline_control():
    with socket.socket() as probe:
        probe.settimeout(1)
        try:
            probe.connect(("1.1.1.1", 443))
        except PermissionError:
            return "EPERM: network denied by operating system"
        except OSError as error:
            raise RuntimeError("Offline control requires EPERM, not a network outage") from error
    raise RuntimeError("Network is available; launch under the documented deny-network sandbox")


def occurrences(text, phrase):
    tokens, target = normalize(text), normalize(phrase)
    return sum(tokens[i:i + len(target)] == target for i in range(len(tokens) - len(target) + 1))


def entities(words):
    groups = defaultdict(list)
    for word in words:
        for tag in ast.literal_eval(word["tags"] or "[]"):
            if any(kind in tag for kind in ("DATE", "YEAR", "MONEY", "PERCENT", "CARDINAL", "ORDINAL", "DECIMAL")):
                groups[tag].append(word["text"])
    return [" ".join(value) for value in groups.values()]


def recall_counts(reference, hypothesis, phrases):
    expected = {phrase: occurrences(reference, phrase) for phrase in set(phrases)}
    return {"expected": sum(expected.values()),
            "matched": sum(min(count, occurrences(hypothesis, phrase)) for phrase, count in expected.items())}


def aggregate(records):
    groups = defaultdict(list)
    for record in records:
        for group in ("all", "category:" + record["category"], "country:" + record["country"], "source:" + record["sourceId"]):
            groups[group].append(record)
    result = {}
    for name, rows in groups.items():
        total_words = sum(row["referenceWords"] for row in rows)
        audio = sum(row["audioSeconds"] for row in rows)
        result[name] = {"segments": len(rows), "audioSeconds": audio, "referenceWords": total_words,
                        "wer": sum(row["edits"] for row in rows) / total_words if total_words else None,
                        "rtf": sum(row["decodeSeconds"] for row in rows) / audio,
                        "terms": {key: sum(row["terms"][key] for row in rows) for key in ("expected", "matched")},
                        "numericEntities": {key: sum(row["numericEntities"][key] for row in rows) for key in ("expected", "matched")}}
    return result


def validate_corpus(path):
    corpus = json.loads(path.read_text())
    expected = set(CALLS) | set(MEETINGS) if corpus["scope"] == "all" else (
        set(CALLS) if corpus["scope"] == "earnings" else set(MEETINGS))
    if set(corpus["sources"]) != expected or {r["sourceId"] for r in corpus["records"]} != expected:
        raise ValueError("Incomplete predeclared corpus")
    for record in corpus["records"]:
        if digest(path.parent / record["file"]) != record["sha256"]:
            raise ValueError("Canonical audio checksum mismatch")
    return corpus


def audio_segments(corpus, directory):
    for record in corpus["records"]:
        samples, rate = sf.read(directory / record["file"], dtype="float32")
        if rate != 16000 or samples.ndim != 1:
            raise ValueError("Expected mono 16 kHz corpus")
        for index, segment in enumerate(record["segments"]):
            audio = samples[round(segment["start"] * rate):round(segment["end"] * rate)]
            yield record, segment, f"{record['id']}:{index}", audio


def accuracy(engine, corpus, directory, emit):
    results = []
    for record, segment, identity, samples in audio_segments(corpus, directory):
        engine.requests.put((identity, samples), timeout=TIMEOUT)
        result = engine.receive(TIMEOUT)
        if result["id"] != identity:
            raise RuntimeError("Mismatched engine response")
        row = {"id": identity, "sourceId": record["sourceId"], "category": record["category"],
               "country": record["country"], "audioSeconds": len(samples) / 16000,
               "sourceStart": record["sourceStart"] + segment["start"],
               "overlappingWords": segment["overlappingWords"], "reference": segment["reference"],
               "inferredTimingWords": segment["inferredTimingWords"],
               **result, **score(segment["reference"], result["text"]),
               "terms": recall_counts(segment["reference"], result["text"], corpus["technicalTerms"]),
               "numericEntities": recall_counts(segment["reference"], result["text"], entities(segment["words"]))}
        results.append(row)
        emit({"type": "accuracy", **row})
        if len(results) % 25 == 0:
            print(f"Accuracy: {len(results)} segments, {sum(r['audioSeconds'] for r in results):.0f}s audio", flush=True)
    return aggregate(results)


def replay_events(corpus, directory, duration):
    elapsed = 0.0
    # A deterministic source-balanced montage; no repeated audio fills the hour.
    by_source = {source: {**corpus, "records": [r for r in corpus["records"] if r["sourceId"] == source]}
                 for source in corpus["sources"]}
    streams = [audio_segments(part, directory) for part in by_source.values()]
    ordered = (item for group in zip_longest(*streams) for item in group if item is not None)
    for record, segment, identity, samples in ordered:
        remaining = duration - elapsed
        if remaining <= 0:
            return
        samples = samples[:round(remaining * 16000)]
        seconds = len(samples) / 16000
        for boundary in np.arange(2.0, seconds, 2.0):
            yield {"id": identity + f":p{boundary}", "segment": identity, "due": elapsed + boundary,
                   "segmentStart": elapsed, "final": False, "samples": samples[:round(boundary * 16000)]}
        yield {"id": identity + ":final", "segment": identity, "due": elapsed + seconds,
               "segmentStart": elapsed, "final": True, "samples": samples,
               "reference": segment["reference"] if seconds == segment["end"] - segment["start"] else None}
        elapsed += seconds
    if elapsed < duration - .01:
        raise ValueError("Corpus is shorter than requested replay; no repetition allowed")


def replay(engine, corpus, directory, seconds, emit):
    process_memory = ProcessMemory()
    events = iter(replay_events(corpus, directory, seconds))
    upcoming = next(events, None)
    pending, first, last = {}, {}, {}
    first_delays, final_delays, queue_delays, memory = [], [], [], []
    missing_text = 0
    started, next_memory, next_log = time.monotonic(), 0, 60
    completed, revisions = 0, 0
    while upcoming or pending:
        now = time.monotonic()
        elapsed = now - started
        response = engine.receive()
        if response:
            event = pending.pop(response["id"])
            queue_delay = response["started"] - started - event["due"]
            queue_delays.append(queue_delay)
            segment = event["segment"]
            if response["text"] and segment not in first:
                delay = response["finished"] - started - event["segmentStart"]
                first[segment] = delay
                first_delays.append(delay)
            previous = last.get(segment, "")
            if previous and not response["text"].startswith(previous):
                revisions += 1
            last[segment] = response["text"]
            delay = response["finished"] - started - event["due"]
            if event["final"]:
                final_delays.append(delay)
                if event.get("reference") and segment not in first:
                    missing_text += 1
            emit({"type": "replay", **event, **response, "queueSeconds": queue_delay,
                  "afterAudioSeconds": delay})
            completed += 1
        if upcoming and upcoming["due"] <= elapsed:
            if len(pending) >= QUEUE_LIMIT:
                raise RuntimeError("Replay overload: two outstanding requests; no audio silently dropped")
            event = {key: value for key, value in upcoming.items() if key != "samples"}
            pending[event["id"]] = event
            engine.requests.put_nowait((event["id"], upcoming["samples"]))
            upcoming = next(events, None)
        if any(elapsed - event["due"] > TIMEOUT for event in pending.values()):
            raise TimeoutError("Replay inference response timeout")
        if elapsed >= next_memory:
            measurement = {"elapsedSeconds": elapsed, "rssBytes": process_memory.sample()}
            memory.append(measurement)
            emit({"type": "memory", **measurement})
            next_memory = elapsed + 5
        if elapsed >= next_log:
            print(f"Replay: {elapsed:.0f}/{seconds:.0f}s; completed={completed}; pending={len(pending)}", flush=True)
            next_log += 60
        time.sleep(.005)
    warmed = [item["rssBytes"] for item in memory if item["elapsedSeconds"] >= 60]
    p95 = lambda values: float(np.percentile(values, 95)) if values else None
    return {"wallSeconds": time.monotonic() - started, "audioSeconds": seconds, "requests": completed,
            "firstTextFromSegmentStartP95Seconds": p95(first_delays),
            "finalAfterSegmentEofP95Seconds": p95(final_delays), "queueP95Seconds": p95(queue_delays),
            "revisionUpdates": revisions, "sampledPeakProcessTreeRssBytes": max(m["rssBytes"] for m in memory),
            "warmedMedianRssGrowthBytes": float(np.median(warmed[-12:]) - np.median(warmed[:12])) if warmed else None,
            "queueOverflows": 0, "droppedRequests": 0, "timeouts": 0,
            "spokenSegmentsWithoutText": missing_text,
            "latencyScope": "Oracle bounded windows; no production VAD, microphone, GUI or translation",
            "memoryScope": "Supervisor plus all descendants, sampled every 5 seconds; not an OS high-water mark"}


def validate_native_arch(expected):
    if platform.machine() != expected:
        raise ValueError("Not running on the declared native architecture")
    if platform.machine() == "x86_64":
        translated = subprocess.run(["/usr/sbin/sysctl", "-n", "sysctl.proc_translated"], capture_output=True, text=True)
        if translated.stdout.strip() == "1":
            raise ValueError("Rosetta is not native Intel evidence")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", choices=("whisper", "parakeet"))
    parser.add_argument("corpus", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--whisper-model", type=Path)
    parser.add_argument("--expect-arch", choices=("arm64", "x86_64"), required=True)
    parser.add_argument("--soak-seconds", type=int, default=3600)
    parser.add_argument("--phase", choices=("all", "accuracy", "replay"), default="all")
    args = parser.parse_args()
    validate_native_arch(args.expect_arch)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report = {"status": "INCOMPLETE", "engine": args.engine, "machine": platform.machine(),
              "platform": platform.platform(), "threads": 4, "provider": "cpu",
              "phase": args.phase, "corpusSha256": digest(args.corpus),
              "scoring": "Strict orthographic WER; number formatting not normalized; entity recall is supplementary",
              "replacement": "NOT_AUTHORIZED"}
    engine = None
    with args.output.with_suffix(".jsonl").open("w") as stream:
        def emit(record):
            stream.write(json.dumps(record) + "\n")
            stream.flush()
        try:
            report["offlineControl"] = offline_control()
            report["memoryPreflightBytes"] = ProcessMemory().sample()
            corpus = validate_corpus(args.corpus)
            if args.engine == "whisper":
                model_hash = digest(args.whisper_model)
                if model_hash != "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f":
                    raise ValueError("Whisper production model checksum mismatch")
                report["modelSha256"] = model_hash
                report["adapterSha256"] = digest(args.baseline)
            else:
                report["modelSha256"] = {key: value for key, value in MODEL_SHA256.items() if key.startswith("parakeet/")}
            report["corpusScope"] = corpus["scope"]
            report["license"] = corpus["license"]
            report["attribution"] = corpus["attribution"]
            engine = EngineWorker(vars(args))
            report["loadSeconds"] = engine.ready["loadSeconds"]
            if args.phase != "replay":
                report["accuracy"] = accuracy(engine, corpus, args.corpus.parent, emit)
                args.output.write_text(json.dumps(report, indent=2) + "\n")
            if args.phase != "accuracy":
                report["replay"] = replay(engine, corpus, args.corpus.parent, args.soak_seconds, emit)
            report["status"] = "MEASURED"
        except BaseException:
            report["error"] = traceback.format_exc()
            raise
        finally:
            if engine:
                engine.close()
            args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
