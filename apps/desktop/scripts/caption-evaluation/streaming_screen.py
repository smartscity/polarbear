"""Bounded offline rejection screen, never a production caption qualification.

Use an OS deny-network sandbox and local, preverified assets. The CLI requires
the expected corpus and baseline-helper SHA-256 values before running either
engine. Accuracy uses accelerated whole clips, sequentially per engine. Optional
paced probes measure clip-start delay, not production VAD or microphone/UI delay.
"""

import argparse
import errno
import json
import math
import multiprocessing as mp
import os
from pathlib import Path
import platform
import socket
import time
import traceback

import numpy as np

from evaluate import SherpaCandidate, WhisperBaseline, inference_threads
from metrics import score, words
from prepare import METADATA_GIT_BLOBS, MODELS, MODEL_SHA256, verify_model
from qualification_corpus import CALLS, MEETINGS, digest
from qualify import (EngineWorker, aggregate, audio_segments, entities,
                     recall_counts, validate_corpus, validate_native_arch)


SOURCES = (*CALLS, *MEETINGS)
MAX_CLIP_SECONDS = 20
MAX_ACCURACY_SECONDS = 480
MAX_PACED_SECONDS = 160
REQUEST_TIMEOUT = 30
MAX_DEADLINE_SECONDS = 300
WHISPER_SHA256 = "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f"


def select_clips(corpus):
    """Freeze first/middle/last annotated clips, with no substitution or trimming."""
    if (corpus["scope"] != "all" or len(corpus["sources"]) != 8
            or set(corpus["sources"]) != set(SOURCES)
            or {row["sourceId"] for row in corpus["records"]} != set(SOURCES)):
        raise ValueError("Screen requires all eight frozen sources")
    clips = []
    for source in SOURCES:
        record = next(row for row in corpus["records"] if row["sourceId"] == source)
        annotated = [(index, segment) for index, segment in enumerate(record["segments"])
                     if words(segment["reference"])]
        if len(annotated) < 3:
            raise ValueError(f"First record needs three annotated segments: {source}")
        for position, ordinal in zip(("first", "middle", "last"), (0, len(annotated) // 2, len(annotated) - 1)):
            index, segment = annotated[ordinal]
            start, end = segment["start"], segment["end"]
            if (not math.isfinite(start) or not math.isfinite(end)
                    or not 0 <= start < end):
                raise ValueError(f"Selected segment exceeds the 20-second bound: {source}:{index}")
            # Match qualify.audio_segments' frame boundaries, not float subtraction.
            sample_count = round(end * 16000) - round(start * 16000)
            if not 0 < sample_count <= MAX_CLIP_SECONDS * 16000:
                raise ValueError(f"Selected segment exceeds the 20-second bound: {source}:{index}")
            clips.append({"id": f"{record['id']}:{index}", "recordId": record["id"],
                          "sourceId": source, "category": record["category"], "country": record["country"],
                          "file": record["file"], "sha256": record["sha256"],
                          "sourceStart": record["sourceStart"], "segmentIndex": index,
                          "position": position, "segment": segment, "sampleCount": sample_count})
    if len({clip["id"] for clip in clips}) != 24:
        raise ValueError("Selected clip identities must be unique")
    if sum(clip["sampleCount"] for clip in clips) > MAX_ACCURACY_SECONDS * 16000:
        raise ValueError("Accuracy selection exceeds 480 seconds")
    if sum(clip["sampleCount"] for clip in clips if clip["position"] == "first") > MAX_PACED_SECONDS * 16000:
        raise ValueError("Paced selection exceeds 160 seconds")
    return clips


def selected_audio(clips, directory):
    records = [{**clip, "segments": [clip["segment"]]} for clip in clips]
    for clip, (_, _, _, samples) in zip(clips, audio_segments({"records": records}, directory), strict=True):
        if (not 0 < len(samples) <= MAX_CLIP_SECONDS * 16000
                or len(samples) != clip["sampleCount"] or not np.isfinite(samples).all()):
            raise ValueError("Invalid selected PCM")
        yield clip, samples


def accuracy_row(clip, result, terms, audio_seconds):
    text = result["text"]
    seconds = result["decodeSeconds"]
    if not isinstance(text, str) or not math.isfinite(seconds) or seconds < 0:
        raise ValueError("Invalid accuracy response")
    segment = clip["segment"]
    return {"id": clip["id"], "sourceId": clip["sourceId"], "category": clip["category"],
            "country": clip["country"], "audioSeconds": audio_seconds,
            "sourceStart": clip["sourceStart"] + segment["start"],
            "reference": segment["reference"], "text": text, "decodeSeconds": seconds,
            "empty": not words(text), **score(segment["reference"], text),
            "overlappingWords": segment.get("overlappingWords", 0),
            "inferredTimingWords": segment.get("inferredTimingWords", 0),
            "terms": recall_counts(segment["reference"], text, terms),
            "numericEntities": recall_counts(segment["reference"], text, entities(segment.get("words", [])))}


def summarize_accuracy(rows):
    summary = aggregate(rows)
    for group, values in summary.items():
        field, _, name = group.partition(":")
        key = {"category": "category", "source": "sourceId", "country": "country"}.get(field)
        members = rows if group == "all" else [row for row in rows if row[key] == name]
        values["emptyClips"] = sum(row["empty"] for row in members)
        counts = values["terms"]
        counts["recall"] = counts["matched"] / counts["expected"] if counts["expected"] else None
    return summary


def summarize_paced(rows, expected_ids):
    if len({row["id"] for row in rows}) != len(rows) or {row["id"] for row in rows} != set(expected_ids):
        raise ValueError("Incomplete paced selection")
    delays, missing, empty = [], [], []
    for row in rows:
        if not isinstance(row["text"], str):
            raise ValueError("Invalid paced final text")
        if not words(row["text"]):
            empty.append(row["id"])
        first = None
        previous = 0
        for update in row["updates"]:
            elapsed = update["wallSeconds"]
            if (not isinstance(update["text"], str) or not math.isfinite(elapsed)
                    or elapsed < previous or elapsed > row["wallSeconds"]):
                raise ValueError("Invalid paced partial")
            previous = elapsed
            if words(update["text"]) and first is None:
                first = elapsed
        if first is None:
            missing.append(row["id"])
        else:
            delays.append(first)
    observed_p95 = float(np.percentile(delays, 95)) if delays else None
    return {"status": "MEASURED", "clips": len(rows), "missingPartials": missing,
            "emptyFinals": empty, "observedOnlyFirstPartialP95Seconds": observed_p95,
            "firstPartialFromClipStartP95Seconds": observed_p95 if not missing else None,
            "firstPartialWithin3Seconds": bool(rows) and not missing and not empty and observed_p95 <= 3,
            "timingScope": "Clip start, including initial silence; not production VAD or microphone/UI latency",
            "records": rows}


def screening_decision(baseline, candidate, paced=None):
    checks = {}
    comparable = ("all" in baseline and baseline.keys() == candidate.keys()
                  and baseline["all"]["segments"] == candidate["all"]["segments"] == 24)
    if comparable:
        for group in baseline:
            left, right = baseline[group], candidate[group]
            comparable = comparable and all(left[key] == right[key] for key in ("segments", "referenceWords", "audioSeconds"))
            comparable = comparable and left["terms"]["expected"] == right["terms"]["expected"]
    checks["completePairedSelection"] = comparable
    if comparable:
        for group in baseline:
            if group != "all" and not group.startswith("category:"):
                continue
            left, right = baseline[group], candidate[group]
            checks[f"wer:{group}"] = (left["wer"] is not None and right["wer"] is not None
                                       and math.isfinite(left["wer"]) and math.isfinite(right["wer"])
                                       and right["wer"] <= left["wer"])
            checks[f"emptyClips:{group}"] = right["emptyClips"] <= left["emptyClips"]
            if left["terms"]["expected"]:
                checks[f"termRecall:{group}"] = right["terms"]["matched"] >= left["terms"]["matched"]
    if paced is not None:
        checks["pacedFirstPartial"] = paced["clips"] == 8 and paced["firstPartialWithin3Seconds"]
    reasons = [name for name, value in checks.items() if not value]
    return {"recommendation": "NO_REPLACE" if reasons else "FURTHER_EVALUATION_ONLY",
            "checks": checks, "reasons": reasons, "replacement": "NOT_AUTHORIZED",
            "scope": "Rejection screen only; unchanged accuracy is not proof of production non-regression"}


def require_offline():
    # Unlike a generic PermissionError check, require the precise sandbox errno.
    with socket.socket() as probe:
        probe.settimeout(1)
        try:
            probe.connect(("1.1.1.1", 443))
        except OSError as error:
            if error.errno == errno.EPERM:
                return "EPERM: network denied by operating system"
            raise RuntimeError("Offline screening requires EPERM, not an outage or EACCES") from error
    raise RuntimeError("Network is available; use an OS deny-network sandbox")


def screen_worker(config, requests, replies):
    os.setsid()
    engine = None
    try:
        offline = require_offline()
        engine = (WhisperBaseline(config["baseline"], config["whisper_model"], config["threads"])
                  if config["engine"] == "whisper" else
                  SherpaCandidate(config["engine"], Path(config["models"]) / config["engine"], config["threads"]))
        replies.put({"ready": True, "loadSeconds": engine.load_seconds, "threads": engine.threads,
                     "runtimeVersion": getattr(engine, "version", "pinned whisper.cpp baseline"),
                     "offlineControl": offline})
        while (job := requests.get()) is not None:
            operation, identity, samples = job
            if operation == "accuracy":
                result = engine.transcribe(samples)
            elif operation == "paced" and config["engine"] != "whisper":
                result = engine.paced_probe(samples)
            else:
                raise ValueError("Unsupported screen operation")
            replies.put({"id": identity, **result})
    except BaseException:
        replies.put({"error": traceback.format_exc()})
    finally:
        if engine is not None:
            engine.close()


class ScreenWorker(EngineWorker):
    """Reuse the qualification supervisor's process-group cleanup, one request at a time."""

    def __init__(self, config, deadline):
        self.deadline = deadline
        context = mp.get_context("spawn")
        self.requests = context.Queue(maxsize=1)
        self.replies = context.Queue(maxsize=1)
        self.process = context.Process(target=screen_worker, args=(config, self.requests, self.replies))
        self.process.start()
        try:
            self.ready = self.receive(self.remaining())
            if not self.ready.get("ready") or self.ready.get("threads") != config["threads"]:
                raise RuntimeError("Screen worker startup/thread budget mismatch")
        except BaseException:
            self.close()
            raise

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Screen inference deadline exceeded")
        return min(REQUEST_TIMEOUT, remaining)

    def request(self, operation, identity, samples):
        self.requests.put((operation, identity, samples), timeout=self.remaining())
        result = self.receive(self.remaining())
        if result.get("id") != identity:
            raise RuntimeError("Mismatched screen response")
        self.remaining()
        return result


def run_engine(config, clips, corpus, directory, deadline, emit, paced=False):
    worker = ScreenWorker(config, deadline)
    rows, probes = [], []
    try:
        emit({"type": "engineReady", "engine": config["engine"], **worker.ready})
        for clip, samples in selected_audio(clips, directory):
            result = worker.request("accuracy", clip["id"], samples)
            row = accuracy_row(clip, result, corpus["technicalTerms"], len(samples) / 16000)
            rows.append(row)
            emit({"type": "accuracy", "engine": config["engine"], **row})
        if paced:
            first = [clip for clip in clips if clip["position"] == "first"]
            for clip, samples in selected_audio(first, directory):
                result = worker.request("paced", clip["id"], samples)
                probes.append(result)
                emit({"type": "paced", "engine": config["engine"], **result})
        return {"ready": worker.ready, "accuracy": summarize_accuracy(rows), "records": rows,
                "paced": summarize_paced(probes, [clip["id"] for clip in clips if clip["position"] == "first"])
                if paced else {"status": "NOT_RUN"}}
    finally:
        worker.close()


def verify_inputs(args):
    if digest(args.corpus) != args.corpus_sha256:
        raise ValueError("Pinned corpus checksum mismatch")
    if digest(args.baseline) != args.baseline_sha256:
        raise ValueError("Pinned baseline helper checksum mismatch")
    if digest(args.whisper_model) != WHISPER_SHA256:
        raise ValueError("Pinned Whisper model checksum mismatch")
    corpus = validate_corpus(args.corpus)
    model = MODELS[args.candidate]
    hashes = {}
    for filename in model["files"]:
        key = f"{args.candidate}/{filename}"
        if key not in MODEL_SHA256 and key not in METADATA_GIT_BLOBS:
            raise ValueError(f"Unpinned candidate asset: {key}")
        hashes[filename] = verify_model(args.candidate, args.models / args.candidate / filename)
    return corpus, {"corpusSha256": args.corpus_sha256, "baselineHelperSha256": args.baseline_sha256,
                    "whisperModelSha256": WHISPER_SHA256, "candidateModel": {
                        "repo": model["repo"], "revision": model["revision"], "sha256": hashes},
                    "harnessSha256": {name: digest(Path(__file__).with_name(name)) for name in (
                        "streaming_screen.py", "evaluate.py", "qualify.py", "prepare.py", "metrics.py")}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--candidate", choices=tuple(name for name in MODELS if name != "parakeet"),
                        default="zipformer-gigaspeech")
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--whisper-model", type=Path, required=True)
    parser.add_argument("--corpus-sha256", required=True)
    parser.add_argument("--baseline-sha256", required=True)
    parser.add_argument("--expect-arch", choices=("arm64", "x86_64"), required=True)
    parser.add_argument("--threads", type=int, choices=range(1, 17), default=inference_threads())
    parser.add_argument("--paced", action="store_true")
    parser.add_argument("--deadline-seconds", type=int, choices=range(1, MAX_DEADLINE_SECONDS + 1),
                        default=MAX_DEADLINE_SECONDS)
    args = parser.parse_args()
    if args.output.suffix != ".json" or args.output.resolve() in {
            args.corpus.resolve(), args.baseline.resolve(), args.whisper_model.resolve()}:
        parser.error("Output must be a separate .json report, not an input asset")
    report = {"status": "INCOMPLETE", "profile": "streaming-short-screen-v1", "candidate": args.candidate,
              "machine": platform.machine(), "host": platform.node(), "platform": platform.platform(),
              "threads": args.threads, "availableCpus": os.cpu_count(), "provider": "cpu",
              "expectedArchitecture": args.expect_arch,
              "inferenceDeadlineSeconds": args.deadline_seconds, "requestTimeoutSeconds": REQUEST_TIMEOUT,
              "accuracyMode": "Sequential accelerated offline clips; not a latency comparison",
              "scoring": "Strict orthographic WER; punctuation/case ignored, numbers not expanded",
              "productionGate": "NOT_RUN", "nativeCaptionHelper": "NOT_RUN", "microphoneToUi": "NOT_RUN",
              "armQualification": "NOT_RUN", "chineseTranslation": "NOT_RUN", "replacement": "NOT_AUTHORIZED"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    try:
        validate_native_arch(args.expect_arch)
        report["offlineControl"] = require_offline()
        corpus, report["pins"] = verify_inputs(args)
        clips = select_clips(corpus)
        report.update({"selection": clips, "license": corpus["license"], "attribution": corpus["attribution"],
                       "accuracyAudioSecondsPerEngine": sum(clip["sampleCount"] for clip in clips) / 16000,
                       "pacedAudioSeconds": sum(clip["sampleCount"] for clip in clips
                                                if clip["position"] == "first") / 16000 if args.paced else 0})
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        deadline = time.monotonic() + args.deadline_seconds
        with args.output.with_suffix(".jsonl").open("w") as stream:
            def emit(event):
                stream.write(json.dumps(event) + "\n")
                stream.flush()
            for kind in ("whisper", args.candidate):
                report[kind] = run_engine({**vars(args), "engine": kind}, clips, corpus, args.corpus.parent,
                                          deadline, emit, paced=args.paced and kind != "whisper")
                args.output.write_text(json.dumps(report, indent=2) + "\n")
        report["screeningDecision"] = screening_decision(
            report["whisper"]["accuracy"], report[args.candidate]["accuracy"],
            report[args.candidate]["paced"] if args.paced else None)
        report["status"] = "MEASURED"
    except BaseException:
        report["error"] = traceback.format_exc()
        raise
    finally:
        args.output.write_text(json.dumps(report, indent=2) + "\n")
    return 1 if report["screeningDecision"]["recommendation"] == "NO_REPLACE" else 0


if __name__ == "__main__":
    raise SystemExit(main())
