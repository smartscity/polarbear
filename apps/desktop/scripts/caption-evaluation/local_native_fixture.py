"""Bounded local production-path regression, not model/accuracy qualification."""

import argparse
import asyncio
import json
import os
from pathlib import Path
import platform
import traceback

import soundfile as sf

from native_replay import replay
from native_latency_policy import latency_policy
from process_memory import ProcessMemory
from qualification_corpus import digest
from qualify import offline_control, validate_native_arch


def checks(result, seconds):
    policy = latency_policy()
    return {
        "completeFixture": result["audioSeconds"] == seconds,
        "textProduced": result["finals"] > 0,
        "firstText": result["firstFromVadStartP95Seconds"] is not None
        and result["firstFromVadStartP95Seconds"] <= policy["firstTextP95Seconds"],
        "finalText": result["finalAfterVadEndP95Seconds"] is not None
        and result["finalAfterVadEndP95Seconds"] <= policy["finalAfterVadEndP95Seconds"],
        "memoryPeak": result["sampledPeakProcessTreeRssBytes"] is not None
        and result["sampledPeakProcessTreeRssBytes"] <= 2 * 1024**3,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fixture-sha256", required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--expect-arch", choices=("x86_64", "arm64"), required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report = {"profile": "local-production-fixture-v2", "status": "INCOMPLETE",
              "latencyPolicy": latency_policy(),
              "architecture": platform.machine(), "logicalCpus": os.cpu_count(),
              "accuracy": "NOT_SCORED", "microphoneToUi": "NOT_RUN",
              "translation": "NOT_RUN", "modelReplacement": "NOT_AUTHORIZED"}
    with args.output.with_suffix(".jsonl").open("w") as events:
        def emit(event):
            events.write(json.dumps(event) + "\n")
            events.flush()
        try:
            validate_native_arch(args.expect_arch)
            report["network"] = offline_control()
            report["fixtureSha256"] = digest(args.fixture)
            if report["fixtureSha256"] != args.fixture_sha256:
                raise ValueError("Fixture checksum mismatch")
            info = sf.info(args.fixture)
            if info.samplerate != 16000 or info.channels != 1 or not 1 <= info.frames / 16000 <= 180:
                raise ValueError("Expected 1-180 seconds of mono 16 kHz audio")
            audio, _ = sf.read(args.fixture, dtype="float32")
            assets = args.assets.resolve()
            manifest = json.loads((assets / "manifest.json").read_text())
            report["models"] = {}
            for model in manifest["models"]:
                actual = digest(assets / model["file"])
                if actual != model["sha256"]:
                    raise ValueError("Bundled model checksum mismatch")
                report["models"][model["file"]] = actual
            helper = assets / "polarbear-caption-engine"
            report["helperSha256"] = digest(helper)
            command = [str(helper), str(assets / "ggml-base.en-q5_1.bin"),
                       str(assets / "ggml-silero-v6.2.0.bin"), "--diagnostics"]
            report["replay"] = asyncio.run(replay(command, [audio], len(audio) / 16000,
                                                 emit, ProcessMemory().sample, drain_timeout=8))
            report["checks"] = checks(report["replay"], len(audio) / 16000)
            report["status"] = "PASS" if all(report["checks"].values()) else "FAIL"
            if report["status"] != "PASS":
                raise RuntimeError(f"Local production regression failed: {report['checks']}")
        except BaseException as error:
            report["failure"] = f"{type(error).__name__}: {error}"
            report["traceback"] = traceback.format_exc()
            raise
        finally:
            args.output.write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps({key: report[key] for key in ("status", "checks", "failure") if key in report}), flush=True)


if __name__ == "__main__":
    main()
