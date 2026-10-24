import { spawn } from "node:child_process";
import assert from "node:assert/strict";

export function pcm16FromWav(wav) {
  return pcmFromWav(wav, 1, 16);
}

export function float32FromWav(wav) {
  return pcmFromWav(wav, 3, 32);
}

function pcmFromWav(wav, encoding, bits) {
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  let format = false, data;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + size <= wav.length, "Truncated WAV chunk");
    const name = wav.toString("ascii", offset, offset + 4);
    if (name === "fmt ") {
      assert.ok(size >= 16);
      assert.equal(wav.readUInt16LE(offset + 8), encoding);
      assert.equal(wav.readUInt16LE(offset + 10), 1);
      assert.equal(wav.readUInt32LE(offset + 12), 16000);
      assert.equal(wav.readUInt16LE(offset + 22), bits);
      format = true;
    }
    if (name === "data") data = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + size % 2;
  }
  assert.ok(format && data?.length && data.length % (bits / 8) === 0, "Expected mono 16 kHz WAV with the requested encoding");
  return data;
}

const MAX_EVENT_BYTES = 65_536;
const MAX_EVENTS = 1024;
const PHASES = new Set(["loading-asr-cpu", "loading-vad-cpu", "ready", "recognizing-partial", "recognizing-final", "reading-pcm", "stopped"]);
const METRIC_FIELDS = {
  config: ["availableCpus", "threads"],
  vad: ["frames", "computeMs"],
  partial: ["audioMs", "queueMs", "computeMs", "result"],
  final: ["audioMs", "queueMs", "computeMs", "result"],
};

function safeMetric(line) {
  if (!line.startsWith("caption-metric:")) return;
  try {
    const value = JSON.parse(line.slice("caption-metric:".length));
    const fields = Object.hasOwn(METRIC_FIELDS, value?.stage) && METRIC_FIELDS[value.stage];
    if (!fields || !fields.every((key) => Number.isFinite(value[key]) && (key === "result" || value[key] >= 0))) return;
    const metric = Object.fromEntries(fields.map((key) => [key, value[key]]));
    if (["partial", "final"].includes(value.stage)) {
      if (typeof value.cancelled !== "boolean") return;
      metric.cancelled = value.cancelled;
      for (const key of ["sequence", "startMs", "endMs"]) {
        if (Object.hasOwn(value, key)) {
          if (!Number.isSafeInteger(value[key]) || value[key] < 0) return;
          metric[key] = value[key];
        }
      }
      if (Object.hasOwn(value, "textEmitted")) {
        if (typeof value.textEmitted !== "boolean") return;
        metric.textEmitted = value.textEmitted;
      }
    }
    return { stage: value.stage, ...metric };
  } catch { return; }
}

// Exercise the same empty-environment, direct-process boundary used by Desktop.
export function recognizeFixture(executable, args, pcm, {
  name, invalid = false, realtime = false, timeoutMs = 120_000,
  packetSamples = [512], onProgress = () => {}, pcmFormat = "pcm16",
} = {}) {
  assert.ok(pcmFormat === "pcm16" || pcmFormat === "float32");
  const sampleBytes = pcmFormat === "float32" ? 4 : 2;
  assert.equal(pcm.length % sampleBytes, 0);
  if (pcmFormat === "float32") {
    for (let index = 0; index < pcm.length; index += 4) assert.ok(Number.isFinite(pcm.readFloatLE(index)), "Invalid floating point audio");
  }
  assert.ok(packetSamples.length > 0 && packetSamples.every((count) => Number.isInteger(count) && count > 0 && count <= 4096));
  const child = spawn(executable, args, { shell: false, env: {}, stdio: ["pipe", "pipe", "pipe"] });
  const events = [];
  const metrics = [];
  const started = performance.now();
  let phase = "starting", buffer = "", diagnostics = "", failure, ready = false, closed = false;
  let feedStarted = 0, maxWriteLagMs = 0;
  const finalLagMs = [];
  const firstLagMs = [];
  const observedSequences = new Set();
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
      let packet = 0;
      for (let offset = 0; offset < pcm.length / sampleBytes;) {
        if (failure || closed) return;
        const due = feedStarted + offset * 1000 / 16000;
        if (realtime && due > performance.now()) await new Promise((resolve) => setTimeout(resolve, due - performance.now()));
        if (failure || closed) return;
        const count = Math.min(packetSamples[packet++ % packetSamples.length], pcm.length / sampleBytes - offset);
        const frame = Buffer.alloc(12 + count * 4);
        frame.writeBigUInt64LE(BigInt(Math.floor(offset * 1000 / 16000)));
        frame.writeUInt32LE(count, 8);
        for (let i = 0; i < count; i++) frame.writeFloatLE(pcmFormat === "float32" ? pcm.readFloatLE((offset + i) * 4) : pcm.readInt16LE((offset + i) * 2) / 32768, 12 + i * 4);
        await new Promise((resolve, reject) => child.stdin.write(frame, (error) => error ? reject(error) : resolve()));
        if (realtime) {
          maxWriteLagMs = Math.max(maxWriteLagMs, performance.now() - due);
          if (maxWriteLagMs > 10_000) { fail("Capture backlog exceeded ten seconds"); return; }
        }
        offset += count;
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
        const metric = safeMetric(line);
        if (metric && metrics.length < 4096) {
          metrics.push(metric);
          onProgress({ ...progress(), metric });
        }
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
        if (realtime && ["partial", "final"].includes(event.type) && event.english?.trim() && Number.isSafeInteger(event.sequence) && Number.isFinite(event.startMs) && !observedSequences.has(event.sequence)) {
          observedSequences.add(event.sequence);
          firstLagMs.push(performance.now() - feedStarted - event.startMs);
        }
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
      resolve({ ...result, events, metrics, maxWriteLagMs, finalLagMs, firstLagMs });
    });
  });
}
