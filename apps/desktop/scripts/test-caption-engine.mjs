import { recognizeFixture } from "./caption-engine-fixture.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../src-tauri/", import.meta.url));
const assets = process.argv[3] ? resolve(process.argv[3]) : join(root, "resources/caption");
const fixture = process.argv[2];
if (!fixture) throw new Error("Pass the upstream samples/jfk.wav fixture path");
const wav = await readFile(fixture);
assert.equal(wav.toString("ascii", 0, 4), "RIFF");
let data;
for (let offset = 12; offset + 8 <= wav.length;) {
  const size = wav.readUInt32LE(offset + 4);
  const name = wav.toString("ascii", offset, offset + 4);
  if (name === "fmt ") {
    assert.equal(wav.readUInt16LE(offset + 8), 1);
    assert.equal(wav.readUInt16LE(offset + 10), 1);
    assert.equal(wav.readUInt32LE(offset + 12), 16000);
    assert.equal(wav.readUInt16LE(offset + 22), 16);
  }
  if (name === "data") data = wav.subarray(offset + 8, offset + 8 + size);
  offset += 8 + size + size % 2;
}
assert.ok(data);
function recognize(name, pcm, invalid = false) {
  return recognizeFixture(join(assets, "polarbear-caption-engine"),
    [join(assets, "ggml-base.en-q5_1.bin"), join(assets, "ggml-silero-v6.2.0.bin")], pcm,
    { name, invalid, onProgress: (progress) => console.log(JSON.stringify(progress)) });
}
console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, node: process.version, backend: "cpu", timeoutMs: 120_000 }));
const spoken = await recognize("speech", data);
assert.equal(spoken.code, 0);
const finals = spoken.events.filter((event) => event.type === "final");
assert.ok(finals.length > 0);
assert.match(finals.map((event) => event.english).join(" ").toLowerCase(), /country/);
for (const row of finals) assert.ok(row.endMs >= row.startMs);
const silence = await recognize("silence", Buffer.alloc(32000));
assert.equal(silence.code, 0);
assert.equal(silence.events.filter((event) => event.type === "final").length, 0);
const malformed = await recognize("malformed", Buffer.alloc(0), true);
assert.equal(malformed.code, 4);
console.log(JSON.stringify({ fixture: "upstream JFK sample", finalSegments: finals.length, fixtureSamples: data.length / 2, elapsedMs: spoken.elapsedMs, silence: "PASS", malformedFrame: "PASS", liveCapture: "NOT_RUN" }, null, 2));
