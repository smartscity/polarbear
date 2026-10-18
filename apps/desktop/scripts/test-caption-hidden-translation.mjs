import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(tmpdir(), "polarbear-caption-webkit-"));
const policy = process.argv.includes("--default-policy") ? "default" : "disabled";
const jobDelayMs = process.argv.includes("--immediate") ? 0 : 330000;
const samples = [
  "The project deadline is Friday. We need to review the architecture before the release.",
  "Please save this document before closing the window.",
  "The meeting starts at nine tomorrow morning.",
];
const { app: { security: { csp } } } = JSON.parse(await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const messages = [];
const server = createServer(async (request, response) => {
  response.setHeader("Content-Security-Policy", csp);
  if (request.url === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><title>Caption native offline probe</title><script type="module" src="/offline-translation.js"></script>');
    return;
  }
  const path = resolve(directory, `.${decodeURIComponent(request.url.split("?")[0])}`);
  if (!path.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader("Content-Type", path.endsWith(".wasm") ? "application/wasm" : path.endsWith(".js") ? "application/javascript" : "application/octet-stream");
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});

function run(command, args, timeoutMs) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", data => { output += data; process.stdout.write(data); });
    const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Native probe failed: code=${code}, signal=${signal}`));
      else accept(output);
    });
  });
}

try {
  const fixtureId = "\0caption-native-probe";
  await build({ root, configFile: join(root, "vite.config.ts"), logLevel: "warn", plugins: [{
    name: "caption-native-probe",
    resolveId(id) { if (id === "caption-native-probe") return fixtureId; },
    load(id) {
      if (id !== fixtureId) return;
      return `import { createElement } from 'react';
        import { createRoot } from 'react-dom/client';
        import { CaptionTranslator } from ${JSON.stringify(join(root, "src/features/caption/CaptionTranslator.tsx"))};
        import { BergamotWorker } from ${JSON.stringify(join(root, "src/shared/translation/bergamotWorker.ts"))};
        const began = performance.now();
        const send = value => window.webkit.messageHandlers.probe.postMessage(value);
        const translate = BergamotWorker.prototype.translate;
        const call = BergamotWorker.prototype.call;
        BergamotWorker.prototype.call = async function(name, ...args) {
          const started = performance.now();
          try { return await call.call(this, name, ...args); }
          finally { send({ phase: 'worker-timing', operation: name, seconds: (performance.now() - started) / 1000 }); }
        };
        BergamotWorker.prototype.translate = async function(text) {
          try { return await translate.call(this, text); }
          catch (error) { send({ phase: 'translation-error', code: error.code ?? error.name, detail: String(error) }); throw error; }
        };
        const nativeFetch = window.fetch;
        window.fetch = async (...args) => {
          try {
            const response = await nativeFetch(...args);
            if (!response.ok) send({ phase: 'asset-error', status: response.status, path: new URL(response.url).pathname });
            return response;
          } catch (error) { send({ phase: 'fetch-error', detail: String(error) }); throw error; }
        };
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            this.addEventListener('error', event => send({ phase: 'worker-error', message: event.message }));
            this.addEventListener('message', event => {
              if (event.data?.error !== undefined) send({ phase: 'worker-response-error', detail: String(event.data.error) });
            });
          }
        };
        window.addEventListener('error', event => send({ phase: 'page-error', message: event.message }));
        const samples = ${JSON.stringify(samples)};
        let claimedAt = 0, completed = 0, lastClaim = began, maxGap = 0;
        window.__TAURI_INTERNALS__ = { invoke: async (command, { request }) => {
          if (command !== 'caption_request') throw new Error('Unexpected IPC');
          const now = performance.now();
          if (request.action === 'claim') {
            maxGap = Math.max(maxGap, (now - lastClaim) / 1000);
            lastClaim = now;
            if (!claimedAt && completed < samples.length && now - began >= ${jobDelayMs}) {
              claimedAt = now;
              send({ phase: 'claimed', elapsedSeconds: (now - began) / 1000, claimPollMaxGapSeconds: maxGap });
              return { id: completed + 1, lease: 'native-fixture', english: samples[completed] };
            }
            return null;
          }
          if (request.action === 'complete') {
            if (request.id !== completed + 1 || request.lease !== 'native-fixture') throw new Error('Unexpected caption lease');
            completed += 1;
            send({ phase: 'translated', sample: completed, complete: !request.chinese || completed === samples.length,
              text: request.chinese, ...(request.chinese ? {} : { error: 'Caption translation failed' }),
              inferenceSeconds: (now - claimedAt) / 1000, elapsedSeconds: (now - began) / 1000,
              claimedSeconds: (claimedAt - began) / 1000, claimPollMaxGapSeconds: maxGap, visibility: document.visibilityState });
            claimedAt = 0;
            return null;
          }
          throw new Error('Unexpected caption action');
        } };
        send({ phase: 'loaded', visibility: document.visibilityState });
        createRoot(document.body.appendChild(document.createElement('div'))).render(createElement(CaptionTranslator));`;
    },
  }], build: {
    outDir: directory, emptyOutDir: true, rollupOptions: {
      input: "caption-native-probe",
      preserveEntrySignatures: "strict", output: { entryFileNames: "offline-translation.js" },
    },
  } });
  const executable = join(directory, "caption-hidden-webview");
  await run("/usr/bin/xcrun", ["swiftc", join(root, "scripts/caption-hidden-webview.swift"), "-o", executable], 60000);
  await new Promise(accept => server.listen(0, "127.0.0.1", accept));
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`Native WKWebView policy=${policy}; delayed job=${jobDelayMs / 1000}s; ${jobDelayMs ? "background regression" : "immediate diagnostic only"}`);
  const profile = `(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:${server.address().port}"))`;
  const output = await run("/usr/bin/sandbox-exec", ["-p", profile, executable, origin, policy], 440000);
  messages.push(...output.trim().split("\n").map(line => JSON.parse(line)));
  const result = messages.find(message => message.complete);
  assert.ok(result && !result.error);
  const translations = messages.filter(message => message.phase === "translated");
  assert.equal(translations.length, samples.length);
  for (const translation of translations) {
    assert.equal(translation.visibility, "hidden");
    assert.ok(!translation.error && translation.inferenceSeconds < 90);
  }
  if (jobDelayMs) assert.ok(translations[0].claimedSeconds >= 330 && translations[0].claimedSeconds < 333);
  // Gate availability of the delayed job, not an unrelated startup scheduling gap.
  // Preserve the full-lifetime maximum as a diagnostic; this is not a real-time SLA pass.
  assert.match(translations[0].text, /星期五|周五/u);
  assert.match(translations[0].text, /架构|体系结构/u);
  assert.match(translations[1].text, /保存/u);
  assert.match(translations[2].text, /明天/u);
  console.log(`Native ${jobDelayMs ? "background availability" : "immediate diagnostic"} PASS: ${JSON.stringify(translations)}`);
} finally {
  await new Promise(accept => server.close(accept));
  await rm(directory, { recursive: true, force: true });
}
