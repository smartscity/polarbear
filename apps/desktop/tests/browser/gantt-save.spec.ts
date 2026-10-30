import { expect, test } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { nativeFixture, menuItem } from "./fixtures/native";

const source = readFileSync(new URL("../fixtures/gantt-original.mmd", import.meta.url), "utf8");
const markdown = `# Original Gantt\n\n\`\`\`mermaid\n${source}\`\`\`\n`;

test("App Save As and reopen preserve original Gantt bytes through file-backed IPC", async ({ page }, info) => {
  const file = info.outputPath("GanttCopy.md");
  await mkdir(info.outputDir, { recursive: true });
  await nativeFixture(page);
  await page.exposeFunction("__ganttRead", async (path: string) => path === "/test/GanttCopy.md" ? readFile(file, "utf8") : markdown);
  await page.exposeFunction("__ganttWrite", async (text: string) => { await writeFile(file, text, "utf8"); });
  await page.addInitScript(() => {
    type Runtime = { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
    const bridge = window as unknown as { __TAURI_INTERNALS__: Runtime; __ganttRead: (path: string) => Promise<string>; __ganttWrite: (text: string) => Promise<void> };
    const invoke = bridge.__TAURI_INTERNALS__.invoke;
    bridge.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
      if (command === "plugin:dialog|save") return "/test/GanttCopy.md";
      if (command === "open_markdown_file") {
        const path = String(args.filePath);
        const name = path.split("/").at(-1)!;
        return { workspaceRoot: "/test", relativePath: name, markdownContent: await bridge.__ganttRead(path), revision: "gantt", tree: [{ id: name, name, itemType: "file" }] };
      }
      if (command === "write_markdown_file") {
        await bridge.__ganttWrite(String(args.markdownContent));
        return { revision: "saved-gantt" };
      }
      return invoke(command, args);
    };
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/features/workspace/recentDocuments.ts";
    (await import(path)).recentDocumentStore().record("/test/Gantt.md", 1);
  });
  await menuItem(page, /^Gantt.md/);
  await expect(page.locator(".cm-typora-diagram-content svg")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect(page.locator(".window-tab.active")).toContainText("GanttCopy.md");
  expect(await readFile(file, "utf8")).toBe(markdown);
  await page.getByRole("button", { name: "Close GanttCopy.md", exact: true }).click();
  await menuItem(page, /^GanttCopy.md/);
  await expect(page.locator(".cm-typora-diagram-content svg")).toContainText("14:40 落库");
  expect(await readFile(file, "utf8")).toBe(markdown);
});
