import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pcm16FromWav, recognizeFixture } from "./caption-engine-fixture.mjs";

const [fixture, directory] = process.argv.slice(2);
if (!fixture || !directory) throw new Error("Usage: replay-caption-audio.mjs consented-16khz-mono.wav caption-assets-directory");
const assets = resolve(directory);
const audio = await readFile(fixture);
const pcm = pcm16FromWav(audio);
const durationMs = pcm.length / 32;
assert.ok(durationMs <= 600_000, "Use the qualification harness for sessions over ten minutes");
const executable = join(assets, "polarbear-caption-engine");
console.log(JSON.stringify({ architecture: process.arch, durationMs,
  audioSha256: createHash("sha256").update(audio).digest("hex"),
  engineSha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
  modelSha256: createHash("sha256").update(await readFile(join(assets, "ggml-base.en-q5_1.bin"))).digest("hex") }));
const result = await recognizeFixture(executable,
  [join(assets, "ggml-base.en-q5_1.bin"), join(assets, "ggml-silero-v6.2.0.bin")], pcm,
  { name: "paced-public-fixture", realtime: true, timeoutMs: durationMs + 60_000,
    onProgress: (progress) => console.log(JSON.stringify(progress)) });
const finals = result.events.filter((event) => event.type === "final");
const lags = [...result.finalLagMs].sort((a, b) => a - b);
console.log(JSON.stringify({ code: result.code, durationMs, elapsedMs: result.elapsedMs,
  finalSegments: finals.length, maxWriteLagMs: result.maxWriteLagMs,
  p95FinalLagMs: lags[Math.ceil(lags.length * 0.95) - 1], maxFinalLagMs: lags.at(-1),
  errors: result.events.filter((event) => event.type === "error").map((event) => event.code),
  microphoneCapture: "NOT_RUN", accuracyQualification: "NOT_RUN" }));
assert.equal(result.code, 0);
assert.ok(finals.length > 0);
assert.equal(result.events.filter((event) => event.type === "error").length, 0);
assert.equal(result.events.at(-1).type, "stopped");
for (let i = 1; i < finals.length; ++i) assert.ok(finals[i].sequence > finals[i - 1].sequence);
