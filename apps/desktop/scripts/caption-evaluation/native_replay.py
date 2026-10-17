"""Paced public-corpus replay through the actual production PCM/VAD/ASR helper."""

import argparse
import asyncio
import json
from pathlib import Path
import platform
import struct
import time
import traceback

import numpy as np

from process_memory import ProcessMemory
from qualification_corpus import digest
from qualify import offline_control, replay_events, validate_corpus, validate_native_arch


def montage(corpus, directory, seconds):
    # Reuse the frozen source-balanced order, not its oracle inference boundaries.
    for event in replay_events(corpus, directory, seconds):
        if event["final"]:
            yield np.asarray(event["samples"], dtype="<f4")


async def replay(command, audio, seconds, emit, memory_sample, startup_timeout=60, drain_timeout=60):
    process = await asyncio.create_subprocess_exec(
        *command, env={}, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, limit=65536)
    ready = asyncio.Event()
    feed_started = None
    frames = samples_sent = finals = 0
    stopped = False
    max_write_lag = 0
    previous_sequence = 0
    first_sequence = 0
    first_delays, final_delays, memory = [], [], []
    partials = 0

    async def read():
        nonlocal stopped, finals, previous_sequence, first_sequence, partials
        while line := await process.stdout.readline():
            event = json.loads(line)
            kind = event.get("type")
            if kind == "ready":
                if ready.is_set() or event.get("protocol") != 1 or event.get("backend") != "cpu":
                    raise RuntimeError("Invalid helper handshake")
                ready.set()
            elif kind == "error":
                raise RuntimeError(f"Helper failure: {event.get('code')}")
            elif kind in ("final", "partial"):
                if feed_started is None or stopped:
                    raise RuntimeError("Text outside an active PCM session")
                sequence, start, end = event["sequence"], event["startMs"], event["endMs"]
                if not all(isinstance(value, int) and value >= 0 for value in (sequence, start, end)) or end < start:
                    raise RuntimeError("Invalid caption position")
                if end > samples_sent * 1000 / 16000 + 64 or sequence <= previous_sequence:
                    raise RuntimeError("Nonmonotonic or future caption")
                now = time.monotonic() - feed_started
                if sequence > first_sequence:
                    first_sequence = sequence
                    first_delays.append(now - start / 1000)
                if kind == "final":
                    previous_sequence = sequence
                    finals += 1
                    final_delays.append(now - end / 1000)
                else:
                    partials += 1
                # Public fixture output stays in the evidence artifact, never a user recording.
                emit({"type": "caption", "arrivalSeconds": now, "event": event})
            elif kind == "stopped":
                if not ready.is_set() or stopped:
                    raise RuntimeError("Invalid stop acknowledgement")
                stopped = True
            else:
                raise RuntimeError("Unknown helper event")
        if not ready.is_set() or not stopped:
            raise RuntimeError("Helper exited without completing the session")

    async def feed():
        nonlocal feed_started, frames, samples_sent, max_write_lag
        await asyncio.wait_for(ready.wait(), startup_timeout)
        feed_started = time.monotonic()
        for samples in audio:
            if samples.ndim != 1 or not np.isfinite(samples).all() or np.max(np.abs(samples), initial=0) > 2:
                raise ValueError("Invalid fixture PCM")
            for offset in range(0, len(samples), 512):
                frame = samples[offset:offset + 512]
                due = feed_started + samples_sent / 16000
                await asyncio.sleep(max(0, due - time.monotonic()))
                header = struct.pack("<QI", samples_sent * 1000 // 16000, len(frame))
                samples_sent += len(frame)
                process.stdin.write(header + frame.astype("<f4", copy=False).tobytes())
                await asyncio.wait_for(process.stdin.drain(), 10)
                frames += 1
                max_write_lag = max(max_write_lag, time.monotonic() - due)
                if max_write_lag >= 10:
                    raise RuntimeError("Capture feed exceeded the unchanged ten-second budget")
        if samples_sent != round(seconds * 16000):
            raise RuntimeError("Corpus did not deliver the requested duration")
        process.stdin.close()
        await process.stdin.wait_closed()
        await asyncio.wait_for(process.wait(), drain_timeout)

    async def sample_memory():
        next_report = 0
        while True:
            if feed_started is not None:
                elapsed = time.monotonic() - feed_started
                measurement = {"elapsedSeconds": elapsed, "rssBytes": memory_sample()}
                memory.append(measurement)
                emit({"type": "memory", **measurement})
                if elapsed >= next_report:
                    print(f"Production replay: {elapsed:.0f}/{seconds}s; finals={finals}; max feed lag={max_write_lag:.3f}s", flush=True)
                    next_report += 60
            await asyncio.sleep(5)

    tasks = [asyncio.create_task(read()), asyncio.create_task(feed()), asyncio.create_task(sample_memory())]
    try:
        async with asyncio.timeout(startup_timeout + seconds + drain_timeout):
            pending = set(tasks[:2])
            while pending:
                done, _ = await asyncio.wait(pending | {tasks[2]}, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
                    pending.discard(task)
            if process.returncode != 0:
                raise RuntimeError(f"Helper exited with code {process.returncode}")
    finally:
        for task in tasks:
            task.cancel()
        if process.returncode is None:
            process.kill()
        await process.wait()
        await asyncio.gather(*tasks, return_exceptions=True)
    warmed = [row["rssBytes"] for row in memory if row["elapsedSeconds"] >= 60]
    p95 = lambda values: float(np.percentile(values, 95)) if values else None
    return {"audioSeconds": samples_sent / 16000, "frames": frames, "finals": finals, "partials": partials,
            "wallSeconds": time.monotonic() - feed_started, "maxWriteLagSeconds": max_write_lag,
            "firstFromVadStartP95Seconds": p95(first_delays), "finalAfterVadEndP95Seconds": p95(final_delays),
            "sampledPeakProcessTreeRssBytes": max((row["rssBytes"] for row in memory), default=None),
            "warmedMedianRssGrowthBytes": float(np.median(warmed[-12:]) - np.median(warmed[:12])) if len(warmed) >= 24 else None,
            "queueOverflows": 0, "timeouts": 0,
            "latencyScope": "Production VAD and PCM queues; no microphone, GUI or Chinese translation"}


def acceptance(result):
    checks = {
        "fullHour": result["audioSeconds"] == 3600,
        "textProduced": result["finals"] > 0,
        "firstText": result["firstFromVadStartP95Seconds"] is not None and result["firstFromVadStartP95Seconds"] <= 3,
        "finalText": result["finalAfterVadEndP95Seconds"] is not None and result["finalAfterVadEndP95Seconds"] <= 4.4,
        "memoryPeak": result["sampledPeakProcessTreeRssBytes"] is not None and result["sampledPeakProcessTreeRssBytes"] <= 2 * 1024**3,
        "memoryGrowth": result["warmedMedianRssGrowthBytes"] is not None and result["warmedMedianRssGrowthBytes"] <= 100 * 1024**2,
    }
    return checks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--expect-arch", choices=("arm64", "x86_64"), required=True)
    args = parser.parse_args()
    validate_native_arch(args.expect_arch)
    report = {"status": "INCOMPLETE", "machine": platform.machine(), "platform": platform.platform(),
              "microphoneToUi": "NOT_RUN", "chineseTranslation": "NOT_RUN", "accuracy": "NOT_SCORED"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.with_suffix(".jsonl").open("w") as stream:
        def emit(event):
            stream.write(json.dumps(event) + "\n")
            stream.flush()
        try:
            report["offlineControl"] = offline_control()
            corpus = validate_corpus(args.corpus)
            report.update({"corpusSha256": digest(args.corpus), "license": corpus["license"], "attribution": corpus["attribution"]})
            manifest = json.loads((args.assets / "manifest.json").read_text())
            for model in manifest["models"]:
                if digest(args.assets / model["file"]) != model["sha256"]:
                    raise ValueError("Bundled model checksum mismatch")
            command = [str(args.assets / name) for name in ("polarbear-caption-engine", "ggml-base.en-q5_1.bin", "ggml-silero-v6.2.0.bin")]
            report["helperSha256"] = digest(Path(command[0]))
            memory = ProcessMemory()
            report["memoryPreflightBytes"] = memory.sample()
            report["replay"] = asyncio.run(replay(command, montage(corpus, args.corpus.parent, 3600), 3600, emit, memory.sample))
            report["checks"] = acceptance(report["replay"])
            report["status"] = "PASS" if all(report["checks"].values()) else "FAIL"
            if report["status"] != "PASS":
                raise RuntimeError(f"Production replay gates failed: {report['checks']}")
        except BaseException:
            report["error"] = traceback.format_exc()
            raise
        finally:
            args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
