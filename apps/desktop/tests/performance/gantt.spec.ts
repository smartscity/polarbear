import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cpus, platform, release, loadavg } from "node:os";
import { execFileSync } from "node:child_process";

const original = readFileSync(new URL("../fixtures/gantt-original.mmd", import.meta.url), "utf8");
const generate = (count: number) => "gantt\ndateFormat YYYY-MM-DD HH:mm\n" + Array.from({ length: count }, (_, i) => `Task ${i}: 14:40 :t${i}, 2026-10-19 14:40, 1h`).join("\n");

test("measures bounded Gantt workloads through Markdown extraction and the production renderer", async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(() => "__quality" in window);
  const report = {
    scope: "Local absolute latency characterization; not a cross-version comparison or a capacity/SLA benchmark.",
    environment: { platform: platform(), os: release(), cpu: cpus()[0].model, node: process.version, browser: browser.version(), loadBefore: loadavg(), thermal: process.platform === "darwin" ? execFileSync("pmset", ["-g", "therm"], { encoding: "utf8" }) : "unavailable" },
    sourceHashes: Object.fromEntries(["ganttSourceAdapter.ts", "ganttDatePolicy.ts", "ganttScheduleValidation.ts", "mermaidRenderer.ts"].map((file) => [file, createHash("sha256").update(readFileSync(new URL(`../../src/features/diagram/${file}`, import.meta.url))).digest("hex")])),
    rows: [] as { tasks: number; fixtureHash: string; warmupMs: number; samplesMs: number[]; medianMs: number; maxMs: number }[],
    errors,
  };
  try {
    for (const [tasks, source] of [[11, original], [50, generate(50)], [200, generate(200)]] as const) {
      const samples: number[] = [];
      for (let iteration = 0; iteration < 6; iteration++) {
        samples.push(await page.evaluate(async ({ source, iteration }) => {
          const rendererPath = "/src/features/diagram/mermaidRenderer.ts", markdownPath = "/src/features/preview/splitMarkdownIntoSegments.ts";
          const { renderMermaidSvg } = await import(rendererPath), { splitMarkdownIntoSegments } = await import(markdownPath);
          const start = performance.now();
          const segments = splitMarkdownIntoSegments(`\`\`\`mermaid\n${source}\n\`\`\``);
          const block = segments.find((segment: { type: string }) => segment.type === "mermaid");
          const svg = await renderMermaidSvg(`measurement-${iteration}`, block.content);
          if (!svg.includes("<svg") || svg.includes("NaN")) throw new Error("Invalid SVG during measurement");
          return performance.now() - start;
        }, { source, iteration }));
      }
      const warmupMs = samples.shift()!;
      const sorted = [...samples].sort((a, b) => a - b);
      report.rows.push({ tasks, fixtureHash: createHash("sha256").update(source).digest("hex"), warmupMs, samplesMs: samples, medianMs: sorted[2], maxMs: sorted[4] });
      // A broad responsiveness gate, not a portable performance promise.
      expect(sorted[4]).toBeLessThan(5_000);
    }
    expect(errors).toEqual([]);
  } finally {
    writeFileSync(info.outputPath("gantt-latency.json"), JSON.stringify({ ...report, loadAfter: loadavg() }, null, 2));
  }
});
