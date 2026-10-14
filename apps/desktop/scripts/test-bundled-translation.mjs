import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium, webkit } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(tmpdir(), "polarbear-translation-"));
const { app: { security: { csp } } } = JSON.parse(await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const server = createServer(async (request, response) => {
  response.setHeader("Content-Security-Policy", csp);
  if (request.url === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en"><title>Offline translation probe</title><body></body></html>');
    return;
  }
  const path = resolve(directory, `.${decodeURIComponent(request.url.split("?")[0])}`);
  if (!path.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader("Content-Type", path.endsWith(".wasm") ? "application/wasm" : path.endsWith(".js") ? "application/javascript" : "application/octet-stream");
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});

try {
  // Use the actual production plugin and asset pipeline, with only a smaller entry point.
  await build({ root, configFile: join(root, "vite.config.ts"), logLevel: "warn", build: {
    outDir: directory, emptyOutDir: true, rollupOptions: {
      input: join(root, "src/features/vocab/translation/offlineTranslation.ts"),
      preserveEntrySignatures: "strict", output: { entryFileNames: "offline-translation.js" },
    },
  } });
  await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const browserType of process.argv.includes("--webkit") ? [chromium, webkit] : [chromium]) {
    const browser = await browserType.launch();
    try {
      const context = await browser.newContext();
      const externalRequests = [];
      const pageErrors = [];
      await context.route("**/*", (route) => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        externalRequests.push(route.request().url());
        return route.abort();
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      await page.goto(origin);
      const results = await page.evaluate(async () => {
        const { translateReadingLocal } = await import("/offline-translation.js");
        const controller = new AbortController();
        const abandoned = translateReadingLocal("Abandoned request.", controller.signal).catch((error) => error.name);
        controller.abort();
        const cancelled = await abandoned;
        const sentence = await translateReadingLocal("This is an English sentence.");
        const paragraph = await translateReadingLocal("Reading helps us understand the world. We can learn something new every day.\n\nPlease save this document before closing the window.");
        const unknown = await translateReadingLocal("OEMS");
        return { cancelled, sentence, paragraph, unknown };
      });
      assert.equal(results.cancelled, "AbortError");
      assert.match(results.sentence, /这是.*句子/u);
      assert.match(results.paragraph, /世界/u);
      assert.match(results.paragraph, /保存/u);
      assert.ok(results.unknown.trim());
      assert.deepEqual(externalRequests, [], "Translation must never request a remote registry or model");
      assert.deepEqual(pageErrors, []);
      console.log(`${browserType.name()} production CSP / bundled inference / cancellation PASS: ${JSON.stringify(results)}`);
      await context.close();
    } finally { await browser.close(); }
  }
} finally {
  await new Promise((accept) => server.close(accept));
  await rm(directory, { recursive: true, force: true });
}
