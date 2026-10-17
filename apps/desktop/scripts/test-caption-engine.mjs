import { pcm16FromWav, recognizeFixture } from "./caption-engine-fixture.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../src-tauri/", import.meta.url));
const assets = process.argv[3] && !process.argv[3].startsWith("--") ? resolve(process.argv[3]) : join(root, "resources/caption");
const realtime = process.argv.includes("--realtime");
const fixture = process.argv[2];
if (!fixture) throw new Error("Pass the upstream samples/jfk.wav fixture path");
const data = pcm16FromWav(await readFile(fixture));
function recognize(name, pcm, invalid = false) {
  return recognizeFixture(join(assets, "polarbear-caption-engine"),
    [join(assets, "ggml-base.en-q5_1.bin"), join(assets, "ggml-silero-v6.2.0.bin"), "--diagnostics"], pcm,
    { name, invalid, realtime: realtime && name === "speech", timeoutMs: realtime ? 180_000 : 120_000,
      onProgress: (progress) => console.log(JSON.stringify(progress)) });
}
console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, node: process.version, backend: "cpu", timeoutMs: realtime ? 180_000 : 120_000 }));
// Repetition is a scheduling regression, not a meeting/accuracy qualification corpus.
const repetitions = realtime ? Math.ceil(90_000 / (data.length / 32)) : 1;
const spoken = await recognize("speech", Buffer.concat(Array.from({ length: repetitions }, () => data)));
assert.equal(spoken.code, 0, `Caption helper failed: ${JSON.stringify(spoken.events.filter(event => event.type === "error"))}`);
assert.equal(spoken.events.filter((event) => event.type === "error").length, 0);
const finals = spoken.events.filter((event) => event.type === "final");
assert.ok(finals.length > 0);
assert.match(finals.map((event) => event.english).join(" ").toLowerCase(), /country/);
for (const row of finals) assert.ok(row.endMs >= row.startMs);
for (let i = 1; i < finals.length; ++i) {
  assert.ok(finals[i].sequence > finals[i - 1].sequence);
  assert.ok(finals[i].startMs >= finals[i - 1].startMs);
}
if (realtime) {
  assert.ok(finals.map((event) => event.english).join(" ").toLowerCase().match(/country/g)?.length >= repetitions);
  assert.ok(spoken.maxWriteLagMs < 10_000);
}
const silence = await recognize("silence", Buffer.alloc(32000));
assert.equal(silence.code, 0);
assert.equal(silence.events.filter((event) => event.type === "final").length, 0);
const malformed = await recognize("malformed", Buffer.alloc(0), true);
assert.equal(malformed.code, 4);
console.log(JSON.stringify({ fixture: "upstream JFK sample", realtime, repetitions, finalSegments: finals.length,
  fixtureSamples: data.length / 2 * repetitions, elapsedMs: spoken.elapsedMs,
  maxWriteLagMs: spoken.maxWriteLagMs, finalLagMs: spoken.finalLagMs,
  silence: "PASS", malformedFrame: "PASS", liveCapture: "NOT_RUN", accuracyQualification: "NOT_RUN" }, null, 2));
