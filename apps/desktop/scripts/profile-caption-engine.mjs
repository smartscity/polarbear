import { pcm16FromWav, recognizeFixture } from "./caption-engine-fixture.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import assert from "node:assert/strict";

const assets = fileURLToPath(new URL("../src-tauri/resources/caption/", import.meta.url));
const pcm = pcm16FromWav(await readFile(process.argv[2]));
// Same model, PCM and executable, sequential runs. This diagnoses thread contention,
// not accuracy or live-session qualification; do not use it to select a new model.
for (const threads of [4, null]) {
  const result = await recognizeFixture(join(assets, "polarbear-caption-engine"), [
    join(assets, "ggml-base.en-q5_1.bin"), join(assets, "ggml-silero-v6.2.0.bin"),
    "--diagnostics", ...(threads ? [`--threads=${threads}`] : []),
  ], pcm, { name: threads ? "fixed-four" : "cpu-budget", onProgress: progress => console.log(JSON.stringify(progress)) });
  assert.equal(result.code, 0);
  assert.match(result.events.filter(event => event.type === "final").map(event => event.english).join(" ").toLowerCase(), /country/);
  console.log(JSON.stringify({ name: result.name, elapsedMs: result.elapsedMs, metrics: result.metrics }));
}
