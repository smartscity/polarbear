import { spawn } from "node:child_process";

const MAX_EVENT_BYTES = 65_536;
const MAX_EVENTS = 1024;
const PHASES = new Set(["loading-asr-cpu", "loading-vad-cpu", "ready", "recognizing-partial", "recognizing-final", "reading-pcm", "stopped"]);

// Exercise the same empty-environment, direct-process boundary used by Desktop.
export function recognizeFixture(executable, args, pcm, { name, invalid = false, timeoutMs = 120_000, onProgress = () => {} } = {}) {
  const child = spawn(executable, args, { shell: false, env: {}, stdio: ["pipe", "pipe", "pipe"] });
  const events = [];
  const started = performance.now();
  let phase = "starting", buffer = "", diagnostics = "", failure, ready = false;
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
        if (event.type === "ready") {
          if (ready || event.protocol !== 1 || event.backend !== "cpu") { fail("Invalid engine handshake"); return; }
          ready = true;
          phase = "feeding-pcm";
          onProgress(progress());
          if (invalid) { const frame = Buffer.alloc(12); frame.writeUInt32LE(5000, 8); child.stdin.end(frame); continue; }
          for (let offset = 0; offset < pcm.length / 2; offset += 512) {
            const count = Math.min(512, pcm.length / 2 - offset);
            const frame = Buffer.alloc(12 + count * 4);
            frame.writeBigUInt64LE(BigInt(Math.floor(offset * 1000 / 16000)));
            frame.writeUInt32LE(count, 8);
            for (let i = 0; i < count; i++) frame.writeFloatLE(pcm.readInt16LE((offset + i) * 2) / 32768, 12 + i * 4);
            child.stdin.write(frame);
          }
          child.stdin.end();
        }
      }
      if (buffer.length > MAX_EVENT_BYTES) fail("Protocol output limit exceeded");
    });
    child.on("close", (code, signal) => {
      cleanup();
      const result = { ...progress(), code, signal };
      onProgress(result);
      if (failure) { reject(failure); return; }
      if (!ready || buffer.trim() || signal) { reject(new Error(`${name}: incomplete engine session; phase=${phase}; code=${code}; signal=${signal}`)); return; }
      resolve({ ...result, events });
    });
  });
}
