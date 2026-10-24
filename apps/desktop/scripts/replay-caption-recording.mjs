// Replay a bounded excerpt of an explicitly recorded session, without network access or new models.
import { open, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { float32FromWav, recognizeFixture } from "./caption-engine-fixture.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  start: { type: "string", default: "0" }, seconds: { type: "string", default: "60" }, assets: { type: "string" },
} });
const [recording, output] = positionals;
assert.ok(recording && output, "Usage: node replay-caption-recording.mjs recording.wav report.json --start 0 --seconds 60");
const start = Number(values.start), seconds = Number(values.seconds);
assert.ok(Number.isFinite(start) && start >= 0 && Number.isFinite(seconds) && seconds >= 1 && seconds <= 180, "Select a 1-180 second excerpt");
const file = await open(recording, "r");
let pcm;
try {
  const header = Buffer.alloc(44);
  assert.equal((await file.read(header, 0, 44, 0)).bytesRead, 44);
  assert.equal(header.toString("ascii", 36, 40), "data", "Expected a Polarbear diagnostic WAV");
  const dataBytes = header.readUInt32LE(40), offset = Math.floor(start * 16000) * 4;
  assert.ok(offset < dataBytes, "Start is outside the recorded audio");
  const bytes = Math.min(dataBytes - offset, Math.floor(seconds * 16000) * 4);
  const excerpt = Buffer.alloc(bytes);
  assert.equal((await file.read(excerpt, 0, bytes, 44 + offset)).bytesRead, bytes, "Recording is truncated");
  header.writeUInt32LE(36 + bytes, 4); header.writeUInt32LE(bytes, 40);
  pcm = float32FromWav(Buffer.concat([header, excerpt]));
} finally { await file.close(); }
const assets = values.assets ?? fileURLToPath(new URL("../src-tauri/resources/caption/", import.meta.url));
const provenance = {};
for (const name of ["polarbear-caption-engine", "ggml-base.en-q5_1.bin", "ggml-silero-v6.2.0.bin"]) {
  provenance[name] = createHash("sha256").update(await readFile(join(assets, name))).digest("hex");
}
const result = await recognizeFixture(join(assets, "polarbear-caption-engine"), [
  join(assets, "ggml-base.en-q5_1.bin"), join(assets, "ggml-silero-v6.2.0.bin"), "--diagnostics",
], pcm, { name: "local-recording", pcmFormat: "float32", realtime: true, timeoutMs: (seconds + 90) * 1000 });
const percentile = (samples, p) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
};
const percentiles = samples => Object.fromEntries([.5, .95, .99].map(p => [`p${p * 100}`, percentile(samples, p)]));
const report = {
  profile: "local-recording-excerpt-v1", architecture: process.arch, startSeconds: start,
  provenance,
  audioSeconds: pcm.length / 64000, excerptSha256: createHash("sha256").update(pcm).digest("hex"),
  firstTextFromAudioStartMs: percentiles(result.firstLagMs), finalAfterAudioEndMs: percentiles(result.finalLagMs),
  accuracy: "NOT_SCORED", microphoneToUi: "NOT_RUN", ...result,
};
// This report contains private recognized text. Keep it local and do not overwrite other evidence.
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
assert.equal(result.code, 0, "Recognition failed; inspect the local report");
assert.ok(!result.events.some(event => event.type === "error"), "Helper reported an error");
console.log(JSON.stringify({ audioSeconds: report.audioSeconds, firstTextFromAudioStartMs: report.firstTextFromAudioStartMs, finalAfterAudioEndMs: report.finalAfterAudioEndMs, accuracy: report.accuracy }));
