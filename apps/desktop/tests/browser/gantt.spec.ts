import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const original = readFileSync(new URL("../fixtures/gantt-original.mmd", import.meta.url), "utf8");
const document = `# Gantt regression\n\n\`\`\`mermaid\n${original}\`\`\`\n\nEditor remains usable.\n`;

async function setSource(page: Page, source: string, mode = "preview") {
  await page.evaluate(({ source, mode }) => {
    const harness = (window as unknown as { __quality: { setMarkdown: (text: string) => void; setMode: (mode: string) => void } }).__quality;
    harness.setMarkdown(source); harness.setMode(mode);
  }, { source, mode });
}
async function render(page: Page, source: string) {
  return page.evaluate(async (source) => {
    const path = "/src/features/diagram/mermaidRenderer.ts";
    const { renderMermaidSvg } = await import(path);
    try {
      const svg = await renderMermaidSvg("gantt-regression", source);
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return { svg, text: [...doc.querySelectorAll("text")].map((item) => item.textContent).join("\n"), error: "" };
    } catch (error) { return { svg: "", text: "", error: String(error) }; }
  }, source);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(() => "__quality" in window);
});

test("original Gantt renders in preview and live editing, copies and reopens without changing Markdown", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await setSource(page, document);
  const svg = page.locator(".mermaid-render-target svg");
  await expect(svg).toBeVisible();
  expect((await svg.boundingBox())!.width).toBeGreaterThan(600);
  await expect(svg).toContainText("14:40 落库");
  await expect(svg).toContainText("2074… 15:08 再成交");
  await expect(svg.locator("rect.milestone")).toHaveCount(7);
  await expect(svg.locator('rect[id$="-a1"]')).toHaveClass(/crit/);
  await expect(svg.locator('rect[id$="-r1"]')).toHaveClass(/active/);
  await expect(page.locator(".mermaid-source code")).toHaveText(original);
  const geometry = await svg.evaluate((element) => {
    const rect = (id: string) => element.querySelector<SVGRectElement>(`rect[id$="-${id}"]`)!;
    const x = (id: string) => Number(rect(id).getAttribute("x"));
    const width = (id: string) => Number(rect(id).getAttribute("width"));
    // A zero-duration milestone is centered at its timestamp, not its left edge.
    return { start: x("a1"), end: x("a1") + width("a1"), milestone: x("a3") + width("a3") / 2,
      longWidth: width("r1"), shortWidth: width("a1") };
  });
  expect(geometry.end).toBeCloseTo(geometry.milestone, 2);
  expect(geometry.longWidth).toBeGreaterThan(geometry.shortWidth * 80);
  await svg.screenshot({ path: `test-results/gantt-original-${test.info().project.name || "chromium"}.png` });
  // Capture clipboard calls on both engines without depending on OS clipboard grants.
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async (text: string) => {
    Object.assign(window, { __copiedGantt: text });
  } }));
  await page.getByRole("button", { name: "Copy source", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __copiedGantt: string }).__copiedGantt)).toBe(original);
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.locator(".cm-typora-diagram-content svg")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("quality.document"))).toBe(document);
  await page.reload();
  await expect(page.locator(".cm-typora-diagram-content svg")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("quality.document"))).toBe(document);
  expect(errors).toEqual([]);
});

test("invalid Gantt is isolated, retry is manual, source is accessible, and edits recover", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const invalid = "gantt\ndateFormat YYYY-MM-DD HH:mm\nTask :a, 2026-10-19 24:40, 0m";
  for (const mode of ["preview", "live"]) {
    await setSource(page, `Before\n\n\`\`\`mermaid\n${invalid}\n\`\`\`\n\nAfter`, mode);
    const error = page.locator(mode === "preview" ? ".mermaid-card-error" : ".cm-typora-diagram-error");
    await expect(error).toContainText("Invalid Gantt date or time");
    await expect(error).toContainText("line 3");
    await error.getByRole("button", { name: "Retry rendering" }).click();
    await expect(error).toContainText("Invalid Gantt date or time");
    await error.locator("summary").click();
    await expect(error.locator("pre").last()).toContainText(invalid);
    await setSource(page, document, mode);
    await expect(page.locator(mode === "preview" ? ".mermaid-render-target svg" : ".cm-typora-diagram-content svg")).toBeVisible();
  }
  expect(await page.locator('body > div[id^="dpolarbear"], body > svg').count()).toBe(0);
  expect(errors).toEqual([]);
});

test("rapid source changes and real CodeMirror edits cannot restore obsolete diagrams", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  for (const mode of ["preview", "live"]) {
    await setSource(page, document, mode);
    for (let index = 0; index < 8; index++) await setSource(page, document.replace("test-3", `obsolete-${index}`), mode);
    await setSource(page, document.replace("test-3", "LATEST"), mode);
    const svg = page.locator(mode === "preview" ? ".mermaid-render-target svg" : ".cm-typora-diagram-content svg");
    await expect(svg).toContainText("LATEST");
    await expect(svg).not.toContainText("obsolete");
  }
  await page.evaluate(() => {
    const harness = (window as unknown as { __quality: { source: () => string; insertText: (at: number, text: string) => void; select: (a: number, b: number) => void } }).__quality;
    const at = harness.source().indexOf("LATEST");
    harness.insertText(at, "EDITED ");
    harness.select(0, 0);
  });
  await expect(page.locator(".cm-typora-diagram-content svg")).toContainText("EDITED LATEST");
  expect(errors).toEqual([]);
});

for (const [format, start, end] of [
  ["YYYY-MM-DD", "2026-10-19", "2026-10-30"],
  ["YYYY-MM-DD HH:mm", "2026-10-19 23:59", "2026-10-30 00:01"],
  ["YYYY-MM-DD HH:mm:ss", "2026-10-19 23:59:59", "2026-10-30 00:00:01"],
  ["DD/MM/YYYY HH:mm", "19/10/2026 23:59", "30/10/2026 00:01"],
  ["YYYY/MM/DD HH:mm:ss", "2026/10/19 23:59:59", "2026/10/30 00:00:01"],
  ["HH:mm", "14:40", "15:08"],
]) test(`real Mermaid renders Unicode, multiple colons, and explicit timestamps: ${format}`, async ({ page }) => {
  const result = await render(page, `gantt\ndateFormat ${format}\n阶段 ②: 14:40: checkpoint :crit, a, ${start}, ${end}\n零时长 :milestone, b, ${end}, 0m`);
  expect(result.error).toBe("");
  expect(result.text).toContain("阶段 ②: 14:40: checkpoint");
  expect(result.svg).not.toMatch(/(?:NaN|Invalid Date)/);
});

test("invalid dependency graphs and excessive timelines fail safely and recover", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  for (const [body, kind] of [
    ["A :a, after missing, 1d", "dependency"],
    ["A :a, after b, 1d\nB :b, after a, 1d", "dependency"],
    ["tickInterval 1millisecond\nA :a, 2026-10-19, 10d", "limit"],
    ["excludes sunday,monday,tuesday,wednesday,thursday,friday,saturday\nA :a, 2026-10-19, 1d", "limit"],
    ["dateFormat DD/MM/YYYY\nA :a, 31/02/2026, 1d", "date"],
    ["excludes weekends\nA :a, 2026-10-23, 1d\nB :b, 2026-10-23, until a", "calendar"],
  ]) {
    expect((await render(page, `gantt\n${body}`)).error).toContain(`Mermaid ${kind} error`);
  }
  expect((await render(page, original)).error).toBe("");
  expect(errors).toEqual([]);
});

test("native scheduling preserves after, until, implicit tasks and calendar exclusions", async ({ page }) => {
  const source = "gantt\ndateFormat YYYY-MM-DD\nexcludes weekends\nA: first :a, 2026-10-23, 1d\nB :b, after a, 1d\nC :1d\nD :d, 2026-10-23, 2026-10-26";
  expect((await render(page, source)).error).toBe("");
  const tasks = await page.evaluate(async (source) => {
    const adapter = "/src/features/diagram/ganttSourceAdapter.ts", engine = "/node_modules/.vite/deps/mermaid.js";
    const { prepareGanttSource } = await import(adapter), { default: mermaid } = await import(engine);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(prepareGanttSource(source));
    return diagram.db.getTasks().map((task: { id: string; startTime: Date; endTime: Date }) => ({ id: task.id, start: task.startTime.getDate(), end: task.endTime.getDate() }));
  }, source);
  expect(tasks).toEqual([{ id: "a", start: 23, end: 26 }, { id: "b", start: 26, end: 27 }, { id: "task1", start: 27, end: 28 }, { id: "d", start: 23, end: 26 }]);
  expect((await render(page, "gantt\nA :a, 2026-10-23, 1d\nB :b, 2026-10-23, until a")).error).toBe("");
});

test("real engine rejects malformed metadata and dates without leaked SVG or unhandled errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  for (const source of ["gantt\nTask :id, 2026-10-19, 1d, extra", "gantt\nTask :id, 2026-10-19, nonsense", "gantt\nTask :id, 2026-02-30, 1d", "flowchart TD\nA[unclosed"]) {
    const result = await render(page, source);
    expect(result.error).toMatch(/Mermaid (syntax|date) error/);
    expect(result.error).not.toContain("TypeError");
  }
  const result = await render(page, original);
  expect(result.error).toBe("");
  expect(await page.locator('body > div[id^="dgantt"], body > svg').count()).toBe(0);
  expect(errors).toEqual([]);
});

const otherDiagrams = {
  flowchart: "flowchart LR\nA[14:40]-->B",
  sequence: "sequenceDiagram\nAlice->>Bob: 14:40 message",
  class: "classDiagram\nAnimal <|-- Duck\nAnimal : int age",
  state: "stateDiagram-v2\n[*] --> Ready\nReady --> Done: finish",
  er: "erDiagram\nCUSTOMER ||--o{ ORDER : places",
  journey: "journey\ntitle Journey\nsection Work\nTask: 5: Me",
  pie: 'pie\n"A": 40\n"B": 60',
  mindmap: "mindmap\n  root((Root))\n    Child",
  timeline: "timeline\n2026 : Event",
  git: "gitGraph\ncommit\ncommit",
};
for (const [name, source] of Object.entries(otherDiagrams)) test(`shared renderer preserves ${name}`, async ({ page }) => {
  const result = await render(page, source);
  expect(result.error).toBe("");
  expect(result.svg).toContain("<svg");
});

test("Gantt task compilation preserves all eleven original timestamps and flags", async ({ page }) => {
  expect((await render(page, original)).error).toBe("");
  const tasks = await page.evaluate(async (source) => {
    const adapterPath = "/src/features/diagram/ganttSourceAdapter.ts";
    const mermaidPath = "/node_modules/.vite/deps/mermaid.js";
    const { prepareGanttSource } = await import(adapterPath);
    const { default: mermaid } = await import(mermaidPath);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(prepareGanttSource(source));
    type Task = { id: string; startTime: Date; endTime: Date; milestone?: boolean; crit?: boolean; active?: boolean };
    const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return (diagram.db.getTasks() as Task[]).map((task) => ({ id: task.id, start: format(task.startTime), end: format(task.endTime), milestone: Boolean(task.milestone), crit: Boolean(task.crit), active: Boolean(task.active) }));
  }, original);
  const expected = [
    ["b0", "2026-10-16 19:13", "2026-10-16 19:13", "milestone"],
    ["b1", "2026-10-18 17:35", "2026-10-18 17:36", "crit"],
    ["b2", "2026-10-18 17:43", "2026-10-18 17:43", "milestone"],
    ["b3", "2026-10-18 17:53", "2026-10-18 17:53", "milestone"],
    ["a1", "2026-10-19 11:38", "2026-10-19 14:40", "crit"],
    ["a2", "2026-10-19 11:43", "2026-10-19 12:53", ""],
    ["a3", "2026-10-19 14:40", "2026-10-19 14:40", "milestone"],
    ["a4", "2026-10-19 15:13", "2026-10-19 15:13", "milestone"],
    ["a5", "2026-10-19 15:33", "2026-10-19 15:33", "milestone"],
    ["r1", "2026-10-18 17:53", "2026-10-30 16:13", "active"],
    ["r2", "2026-10-30 15:53", "2026-10-30 15:53", "milestone"],
  ];
  expect(tasks).toHaveLength(expected.length);
  for (const [id, start, end, flag] of expected) expect(tasks.find((task) => task.id === id)).toEqual({ id, start, end, milestone: flag === "milestone", crit: flag === "crit", active: flag === "active" });
});
