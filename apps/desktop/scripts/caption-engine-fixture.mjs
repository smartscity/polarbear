import { spawn } from "node:child_process";
import assert from "node:assert/strict";

export function pcm16FromWav(wav) {
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  let format = false, data;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + size <= wav.length, "Truncated WAV chunk");
    const name = wav.toString("ascii", offset, offset + 4);
    if (name === "fmt ") {
      assert.ok(size >= 16);
      assert.equal(wav.readUInt16LE(offset + 8), 1);
      assert.equal(wav.readUInt16LE(offset + 10), 1);
      assert.equal(wav.readUInt32LE(offset + 12), 16000);
      assert.equal(wav.readUInt16LE(offset + 22), 16);
      format = true;
    }
    if (name === "data") data = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + size % 2;
  }
  assert.ok(format && data?.length && data.length % 2 === 0, "Expected mono 16 kHz PCM16 WAV");
  return data;
}

const MAX_EVENT_BYTES = 65_536;
const MAX_EVENTS = 1024;
const PHASES = new Set(["loading-asr-cpu", "loading-vad-cpu", "ready", "recognizing-partial", "recognizing-final", "reading-pcm", "stopped"]);

// Exercise the same empty-environment, direct-process boundary used by Desktop.
export function recognizeFixture(executable, args, pcm, { name, invalid = false, realtime = false, timeoutMs = 120_000, onProgress = () => {} } = {}) {
  const child = spawn(executable, args, { shell: false, env: {}, stdio: ["pipe", "pipe", "pipe"] });
  const events = [];
  const started = performance.now();
  let phase = "starting", buffer = "", diagnostics = "", failure, ready = false, closed = false;
  let feedStarted = 0, maxWriteLagMs = 0;
  const finalLagMs = [];
  const progress = () => ({ name, phase, events: events.length, elapsedMs: Math.round(performance.now() - started) });
  onProgress(progress());
  return new Promise((resolve, reject) => {
    const fail = (reason) => {
      failure ??= new Error(`${name}: ${reason}; phase=${phase}; events=${events.length}; elapsedMs=${Math.round(performance.now() - started)}`);
      child.kill("SIGKILL");
    };
    const timeout = setTimeout(() => fail("Caption engine timeout"), timeoutMs);
    const heartbeat = setInterval(() => onProgress(progress()), 10_000);
    const cleanup = () => { clearTimeout(timeout); clearInterval(heartbeat); };
    const feed = async () => {
      feedStarted = performance.now();
      for (let offset = 0; offset < pcm.length / 2; offset += 512) {
        if (failure || closed) return;
        const due = feedStarted + offset * 1000 / 16000;
        if (realtime && due > performance.now()) await new Promise((resolve) => setTimeout(resolve, due - performance.now()));
        if (failure || closed) return;
        const count = Math.min(512, pcm.length / 2 - offset);
        const frame = Buffer.alloc(12 + count * 4);
        frame.writeBigUInt64LE(BigInt(Math.floor(offset * 1000 / 16000)));
        frame.writeUInt32LE(count, 8);
        for (let i = 0; i < count; i++) frame.writeFloatLE(pcm.readInt16LE((offset + i) * 2) / 32768, 12 + i * 4);
        await new Promise((resolve, reject) => child.stdin.write(frame, (error) => error ? reject(error) : resolve()));
        if (realtime) {
          maxWriteLagMs = Math.max(maxWriteLagMs, performance.now() - due);
          if (maxWriteLagMs > 10_000) { fail("Capture backlog exceeded ten seconds"); return; }
        }
      }
      child.stdin.end();
    };
    child.on("error", (error) => { cleanup(); reject(error); });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") fail(`PCM pipe failed (${error.code})`);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk;
      let newline;
      while ((newline = diagnostics.indexOf("\n")) >= 0) {
        const line = diagnostics.slice(0, newline); diagnostics = diagnostics.slice(newline + 1);
        const next = line.startsWith("caption-phase:") ? line.slice("caption-phase:".length) : "";
        if (PHASES.has(next)) { phase = next; onProgress(progress()); }
      }
      // Never log arbitrary stderr, model paths, PCM or recognized text.
      if (diagnostics.length > MAX_EVENT_BYTES) diagnostics = "";
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (failure) return;
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        if (newline > MAX_EVENT_BYTES || events.length >= MAX_EVENTS) { fail("Protocol output limit exceeded"); return; }
        let event;
        try { event = JSON.parse(buffer.slice(0, newline)); } catch { fail("Invalid JSON event"); return; }
        buffer = buffer.slice(newline + 1);
        if (!event || typeof event !== "object") { fail("Invalid protocol event"); return; }
        events.push(event);
        if (realtime && event.type === "final") finalLagMs.push(performance.now() - feedStarted - event.endMs);
        if (event.type === "ready") {
          if (ready || event.protocol !== 1 || event.backend !== "cpu") { fail("Invalid engine handshake"); return; }
          ready = true;
          phase = "feeding-pcm";
          onProgress(progress());
          if (invalid) { const frame = Buffer.alloc(12); frame.writeUInt32LE(5000, 8); child.stdin.end(frame); continue; }
          void feed().catch((error) => { if (!closed && error.code !== "EPIPE") fail(`PCM feed failed (${error.code || "unknown"})`); });
        }
      }
      if (buffer.length > MAX_EVENT_BYTES) fail("Protocol output limit exceeded");
    });
    child.on("close", (code, signal) => {
      closed = true;
      cleanup();
      const result = { ...progress(), code, signal };
      onProgress(result);
      if (failure) { reject(failure); return; }
      if (!ready || buffer.trim() || signal) { reject(new Error(`${name}: incomplete engine session; phase=${phase}; code=${code}; signal=${signal}`)); return; }
      resolve({ ...result, events, maxWriteLagMs, finalLagMs });
    });
  });
}
