"""Short native regression for the Intel first-text failures in run 39124619651."""

import argparse
import asyncio
import json
from pathlib import Path
import platform

import numpy as np

from native_replay import montage, replay
from process_memory import ProcessMemory
from qualification_corpus import digest
from qualify import offline_control, validate_corpus, validate_native_arch

# Include the preceding final, not just isolated utterances: queue contention is
# part of the regression. These offsets are frozen from the failed production run.
WINDOWS = ((0, 60), (140, 180), (350, 420))
SECONDS = sum(end - start + 2 for start, end in WINDOWS)


def regression_audio(corpus, directory):
    samples = np.concatenate(list(montage(corpus, directory, WINDOWS[-1][1])))
    silence = np.zeros(16000, dtype="<f4")
    for start, end in WINDOWS:
        yield silence
        yield samples[start * 16000:end * 16000]
        yield silence


def acceptance(result):
    return {
        "completeRegression": result["audioSeconds"] == SECONDS,
        "textProduced": result["finals"] > 0,
        "firstText": result["firstFromVadStartP95Seconds"] is not None
        and result["firstFromVadStartP95Seconds"] <= 3,
        "finalText": result["finalAfterVadEndP95Seconds"] is not None
        and result["finalAfterVadEndP95Seconds"] <= 4.4,
        "memoryPeak": result["sampledPeakProcessTreeRssBytes"] is not None
        and result["sampledPeakProcessTreeRssBytes"] <= 2 * 1024**3,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--helper", type=Path, required=True)
    parser.add_argument("--expect-arch", choices=("arm64", "x86_64"), required=True)
    parser.add_argument("--threads", type=int, choices=range(1, 17))
    args = parser.parse_args()
    validate_native_arch(args.expect_arch)
    corpus = validate_corpus(args.corpus)
    manifest = json.loads((args.assets / "manifest.json").read_text())
    for model in manifest["models"]:
        if digest(args.assets / model["file"]) != model["sha256"]:
            raise ValueError("Bundled model checksum mismatch")
    report = {"status": "INCOMPLETE", "profile": "intel-first-text-regression-v1",
              "windows": WINDOWS, "requiredAudioSeconds": SECONDS,
              "machine": platform.machine(), "platform": platform.platform(),
              "corpusSha256": digest(args.corpus), "helperSha256": digest(args.helper),
              "license": corpus["license"], "attribution": corpus["attribution"],
              "offlineControl": offline_control(), "memoryGrowth": "NOT_MEASURED_SHORT_PROFILE",
              "microphoneToUi": "NOT_RUN", "chineseTranslation": "NOT_RUN", "accuracy": "NOT_SCORED"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with args.output.with_suffix(".jsonl").open("w") as stream:
            def emit(event):
                stream.write(json.dumps(event) + "\n")
                stream.flush()
            command = [str(args.helper.resolve()),
                       str((args.assets / "ggml-base.en-q5_1.bin").resolve()),
                       str((args.assets / "ggml-silero-v6.2.0.bin").resolve()), "--diagnostics"]
            if args.threads is not None:
                command.append(f"--threads={args.threads}")
            memory = ProcessMemory()
            report["replay"] = asyncio.run(replay(command, regression_audio(corpus, args.corpus.parent),
                                                  SECONDS, emit, memory.sample))
            report["checks"] = acceptance(report["replay"])
            report["status"] = "PASS" if all(report["checks"].values()) else "FAIL"
            if report["status"] != "PASS":
                raise RuntimeError(f"First-text regression failed: {report['checks']}")
    finally:
        args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
