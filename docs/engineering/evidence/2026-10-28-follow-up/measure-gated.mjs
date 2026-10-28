import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [rootArg, output, label] = process.argv.slice(2);
if (!rootArg || !output || !label) throw new Error("Usage: measure-editor.mjs ROOT OUTPUT LABEL");
const root = resolve(rootArg);
const { createServer } = await import(pathToFileURL(resolve(root, "node_modules/vite/dist/node/index.js")));
const server = await createServer({ root: resolve(root, "apps/desktop"), configFile: resolve(root, "apps/desktop/vite.config.ts"), server: { host: "127.0.0.1", port: 1424, strictPort: true } });
const browser = await chromium.launch();
const fingerprint = createHash("sha256");
for (const relative of (await readdir(resolve(root, "apps/desktop/src"), { recursive: true })).sort()) {
  if (/\.(ts|tsx|css|properties)$/.test(relative)) fingerprint.update(relative).update(await readFile(resolve(root, "apps/desktop/src", relative)));
}
const report = { label, sourceFingerprint: fingerprint.digest("hex"), lockFingerprint: createHash("sha256").update(await readFile(resolve(root, "package-lock.json"))).digest("hex"),
  environment: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0].model, browser: browser.version() },
  scope: "Production editor/preview in the browser harness; IPC is mocked. Fixture autosave is disabled, not native document persistence. RSS sums Chromium processes, not the Tauri app.",
  tolerance: { p95Relative: 0.10, p95AbsoluteMs: 20, stableRssRelative: 0.15 }, rows: [], released: [], errors: [] };
const watchdog = setTimeout(() => { report.errors.push("Measurement exceeded 240 seconds"); void browser.close(); }, 240_000);
const block = (bytes) => "# Large source\n\n```text\n" + "A deterministic line for editor performance measurement.\n".repeat(Math.ceil(bytes / 56)).slice(0, bytes) + "\n```\n";
const fixtures = {
  ordinary: "# Engineering notes\n\nRead, edit, save, reopen.\n\n".repeat(80),
  "1MiB": block(1024 ** 2), "10MiB": block(10 * 1024 ** 2),
  diagrams: Array.from({ length: 8 }, (_, i) => `## Flow ${i}\n\n\`\`\`mermaid\ngraph LR\nA${i}[Input]-->B${i}[Output]\n\`\`\`\n`).join("\n"),
};
try {
  await server.listen();
  for (const [fixture, text] of Object.entries(fixtures)) {
    if (process.env.POLARBEAR_PERF_FIXTURES && !process.env.POLARBEAR_PERF_FIXTURES.split(",").includes(fixture)) continue;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(60_000);
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key !== "quality.document") setItem.call(this, key, value); };
      Object.assign(window, { __TAURI_INTERNALS__: { invoke: async () => null } });
    });
    await page.goto("http://127.0.0.1:1424/tests/browser/harness.html");
    await page.waitForFunction(() => Boolean(window.__quality));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    for (let round = 0; round < 6; round++) {
      if (round === 1) {
        await writeFile(output + ".ready", "warmup completed");
        const idleDeadline = Date.now() + 90_000;
        for (;;) {
          try { await readFile(output + ".resume"); break; } catch {}
          if (Date.now() > idleDeadline) throw new Error("Quiet sampling admission timed out");
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      const values = await page.evaluate(async ({ text }) => {
        const q = window.__quality;
        const settled = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const ready = async (predicate) => {
          const deadline = performance.now() + 30_000;
          do { await settled(); if (predicate()) return; } while (performance.now() < deadline);
          throw new Error("Editor did not settle within 30 seconds");
        };
        const begin = performance.now(); q.setMode("source"); q.setMarkdown(text);
        await ready(() => window.__quality.source() === text);
        const openMs = performance.now() - begin;
        const editBegin = performance.now(); window.__quality.insertText(0, "Edited.\n");
        await ready(() => window.__quality.source().startsWith("Edited."));
        const editMs = performance.now() - editBegin;
        const previewBegin = performance.now(); q.setMode("preview"); await settled();
        return { openMs, editMs, previewStart: previewBegin, previewMs: performance.now() - previewBegin };
      }, { text });
      if (fixture === "diagrams") {
        for (let index = 0; index < 8; index++) {
          const diagram = page.locator(".mermaid-render-target").nth(index);
          await diagram.scrollIntoViewIfNeeded(); await diagram.locator("svg").waitFor();
        }
        values.allDiagramsMs = await page.evaluate((start) => performance.now() - start, values.previewStart);
      }
      delete values.previewStart;
      await cdp.send("HeapProfiler.collectGarbage");
      const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
      const system = await browser.newBrowserCDPSession();
      const processes = (await system.send("SystemInfo.getProcessInfo")).processInfo;
      await system.detach();
      const rssKiB = platform() === "win32" ? null : execFileSync("ps", ["-o", "rss=", "-p", processes.map((p) => p.id).join(",")], { encoding: "utf8" }).trim().split(/\s+/).reduce((sum, x) => sum + Number(x), 0);
      const row = { fixture, round, warmup: round === 0, bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex"), ...values,
        rssKiB, jsHeapBytes: metrics.JSHeapUsedSize, taskSeconds: metrics.TaskDuration, nodes: metrics.Nodes };
      report.rows.push(row); console.log(JSON.stringify(row));
      await page.evaluate(() => { window.__quality.setMarkdown(""); window.__quality.setMode("source"); });
      await page.waitForFunction(() => window.__quality.source() === "");
      await page.waitForTimeout(100);
    }
    await page.close();
    await new Promise((done) => setTimeout(done, 200));
    const system = await browser.newBrowserCDPSession();
    const processes = (await system.send("SystemInfo.getProcessInfo")).processInfo;
    report.released.push({ fixture, rssKiB: platform() === "win32" ? null : execFileSync("ps", ["-o", "rss=", "-p", processes.map((p) => p.id).join(",")], { encoding: "utf8" }).trim().split(/\s+/).reduce((sum, x) => sum + Number(x), 0) });
    await system.detach();
  }
} catch (error) { report.errors.push(String(error)); process.exitCode = 1; }
finally {
  clearTimeout(watchdog);
  await browser.close(); await server.close();
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
