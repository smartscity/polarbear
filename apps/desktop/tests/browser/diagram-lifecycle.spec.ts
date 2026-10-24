import { expect, test } from "@playwright/test";

test("a burst of obsolete Mermaid requests is bounded and leaves the renderer usable", async ({ page }) => {
  await page.goto("/tests/browser/navigation.html?documents");
  const result = await page.evaluate(async () => {
    const path = "/src/features/diagram/mermaidRenderer.ts";
    const { renderMermaidSvg } = await import(path);
    const controllers = Array.from({ length: 80 }, () => new AbortController());
    const pending = controllers.map((controller, index) => renderMermaidSvg(`burst-${index}`, `flowchart LR\n A${index} --> B${index}`, controller.signal));
    const settled = Promise.allSettled(pending);
    controllers.slice(1).forEach((controller) => controller.abort());
    const results = await settled;
    const next = await renderMermaidSvg("after-burst", "flowchart LR\n Current --> Ready");
    return { succeeded: results.filter((r) => r.status === "fulfilled").length,
      rejected: results.filter((r) => r.status === "rejected").map((r) => r.reason.name), next: next.includes("Ready") };
  });
  expect(result.succeeded).toBe(1);
  expect(result.rejected).toHaveLength(79);
  expect(result.rejected.every((name) => ["AbortError", "DiagramBusyError"].includes(name))).toBe(true);
  expect(result.next).toBe(true);
});

test("destroyed diagram widgets do not receive late SVG or cancel surviving consumers", async ({ page }) => {
  await page.goto("/tests/browser/navigation.html?documents");
  await page.evaluate(async () => {
    const path = "/src/features/editor/widgets/diagramPreviewWidgets.ts";
    const { MermaidPreviewWidget } = await import(path);
    const block = { from: 0, to: 10, id: "shared", source: "flowchart LR\n Shared --> Survives", type: "mermaid" };
    const first = new MermaidPreviewWidget(block), second = new MermaidPreviewWidget(block);
    const a = first.toDOM(), b = second.toDOM(); a.id = "disposed"; b.id = "surviving";
    document.body.append(a, b); first.destroy(a);
    for (let index = 0; index < 40; index++) {
      const widget = new MermaidPreviewWidget({ ...block, id: String(index), source: `flowchart LR\n A${index} --> B${index}` });
      const dom = widget.toDOM(); widget.destroy(dom);
    }
    Object.assign(window, { __disposeDiagram: () => second.destroy(b) });
  });
  await expect(page.locator("#surviving svg").first()).toBeVisible();
  expect(await page.locator("#disposed .cm-typora-diagram-content svg").count()).toBe(0);
  await page.evaluate(() => (window as any).__disposeDiagram());
});
