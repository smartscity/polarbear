import { spawn } from "node:child_process";
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
async function recognize(pcm, invalid = false) {
  const child = spawn(join(assets, "polarbear-caption-engine"), [join(assets, "ggml-base.en-q5_1.bin"), join(assets, "ggml-silero-v6.2.0.bin")], { shell: false, env: {}, stdio: ["pipe", "pipe", "pipe"] });
  const events = [];
  let buffer = "";
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Caption engine timeout")); }, 120_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const event = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        events.push(event);
        if (event.type === "ready") {
          if (invalid) { const frame = Buffer.alloc(12); frame.writeUInt32LE(5000, 8); child.stdin.end(frame); continue; }
          const samples = pcm.length / 2;
          for (let offset = 0; offset < samples; offset += 512) {
            const count = Math.min(512, samples - offset);
            const frame = Buffer.alloc(12 + count * 4);
            frame.writeBigUInt64LE(BigInt(Math.floor(offset * 1000 / 16000)));
            frame.writeUInt32LE(count, 8);
            for (let i = 0; i < count; i++) frame.writeFloatLE(pcm.readInt16LE((offset + i) * 2) / 32768, 12 + i * 4);
            child.stdin.write(frame);
          }
          child.stdin.end();
        }
      }
    });
    child.on("close", (code) => { clearTimeout(timeout); resolve({ events, code, elapsedMs: Math.round(performance.now() - started) }); });
  });
}
const spoken = await recognize(data);
assert.equal(spoken.code, 0);
const finals = spoken.events.filter((event) => event.type === "final");
assert.ok(finals.length > 0);
assert.match(finals.map((event) => event.english).join(" ").toLowerCase(), /country/);
for (const row of finals) assert.ok(row.endMs >= row.startMs);
const silence = await recognize(Buffer.alloc(32000));
assert.equal(silence.code, 0);
assert.equal(silence.events.filter((event) => event.type === "final").length, 0);
const malformed = await recognize(Buffer.alloc(0), true);
assert.equal(malformed.code, 4);
console.log(JSON.stringify({ fixture: "upstream JFK sample", finalSegments: finals.length, fixtureSamples: data.length / 2, elapsedMs: spoken.elapsedMs, silence: "PASS", malformedFrame: "PASS", liveCapture: "NOT_RUN" }, null, 2));
