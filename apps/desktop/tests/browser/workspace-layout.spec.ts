import { expect, test, type Page } from "@playwright/test";
import { nativeFixture, menuItem } from "./fixtures/native";

async function start(page: Page) {
  await nativeFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("separator", { name: "Resize file sidebar" })).toHaveAttribute("aria-valuenow", "240");
  await page.getByRole("button", { name: "Document Structure", exact: true }).click();
}
async function drag(page: Page, side: "left" | "right", delta: number, cancel?: "Escape" | "blur" | "pointercancel") {
  const handle = page.locator(`.workspace-separator.${side}`), box = await handle.boundingBox();
  if (!box) throw new Error("Missing separator");
  await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + 150, { steps: 8 });
  if (cancel === "Escape") await page.keyboard.press("Escape");
  if (cancel === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  if (cancel === "pointercancel") await handle.dispatchEvent("pointercancel");
  await page.mouse.up();
}

test("resizes independently, persists preferences, and restores them after a narrow window", async ({ page }) => {
  await start(page);
  await drag(page, "left", 80); await drag(page, "right", -40);
  await expect(page.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "320");
  await expect(page.locator(".workspace-separator.right")).toHaveAttribute("aria-valuenow", "280");
  await page.reload();
  await expect(page.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "320");
  await expect(page.locator(".workspace-separator.right")).toHaveAttribute("aria-valuenow", "280");
  await page.setViewportSize({ width: 500, height: 768 });
  await expect(page.locator("#workspace-sidebar")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#workspace-outline")).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "File Tree", exact: true }).click();
  await expect(page.locator("#workspace-sidebar")).toHaveClass(/workspace-drawer/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".workspace-drawer")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "320");
  await expect(page.locator(".workspace-separator.right")).toHaveAttribute("aria-valuenow", "280");
  await page.getByRole("button", { name: "File Tree", exact: true }).click();
  await page.reload();
  await expect(page.locator("#workspace-sidebar")).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "File Tree", exact: true }).click();
  await expect(page.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "320");
});

test("cancels interrupted drags and supports mirrored keyboard resizing and reset", async ({ page }) => {
  await start(page);
  for (const cancel of ["Escape", "blur", "pointercancel"] as const) {
    await drag(page, "left", 100, cancel);
    await expect(page.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "240");
    await expect(page.locator(".main-layout")).not.toHaveAttribute("data-resizing");
  }
  const right = page.getByRole("separator", { name: "Resize document outline" });
  await right.focus(); await page.keyboard.press("Shift+ArrowLeft");
  await expect(right).toHaveAttribute("aria-valuenow", "272");
  await page.keyboard.press("ArrowRight");
  await expect(right).toHaveAttribute("aria-valuenow", "264");
  await right.dblclick(); await expect(right).toHaveAttribute("aria-valuenow", "240");
});

test("keeps the editor instance, dirty content, selection, and undo across resizing", async ({ page }) => {
  await start(page);
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("Layout must preserve this draft.");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  await editor.evaluate((node) => { (window as any).__layoutEditor = node; });
  await drag(page, "left", 100); await drag(page, "right", -80);
  expect(await editor.evaluate((node) => node === (window as any).__layoutEditor)).toBe(true);
  await expect(editor).toContainText("Layout must preserve this draft.");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  await editor.focus();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("Layout must preserve this draft.");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor).toContainText("Layout must preserve this draft.");
});

test("keeps the opposite compressed sidebar stable when committing a resize", async ({ page }) => {
  await start(page);
  await drag(page, "left", 180); await drag(page, "right", -160);
  await page.setViewportSize({ width: 1000, height: 768 });
  const right = page.locator(".workspace-separator.right");
  await expect(right).toHaveAttribute("aria-valuenow", "180");
  const before = await right.getAttribute("aria-valuenow");
  await drag(page, "left", -100);
  await expect(right).toHaveAttribute("aria-valuenow", before!);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(right).toHaveAttribute("aria-valuenow", "400");
});

test("keeps a failed persistence edit usable across unrelated settings events", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await drag(page, "left", 64);
  await expect(page.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "304");
  await page.evaluate(async () => {
    const path = "/src/shared/events/appEvents.ts";
    window.dispatchEvent(new Event((await import(path)).APP_EVENTS.settingsChanged));
  });
  await expect(page.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "304");
});

test("enforces bounds, cancels capture loss and container resize, and restores drawer focus", async ({ page }) => {
  await start(page);
  await drag(page, "left", 700);
  await expect(page.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "420");
  await drag(page, "left", -600);
  const left = page.locator(".workspace-separator.left");
  await expect(left).toHaveAttribute("aria-valuenow", "180");
  for (const cause of ["capture", "resize"]) {
    const box = (await left.boundingBox())!;
    await page.mouse.move(box.x + 3, box.y + 90); await page.mouse.down();
    await page.mouse.move(box.x + 103, box.y + 90);
    if (cause === "capture") await left.dispatchEvent("lostpointercapture");
    else await page.setViewportSize({ width: 1300, height: 800 });
    await expect(page.locator(".main-layout")).not.toHaveAttribute("data-resizing");
    await page.mouse.up();
    await expect(left).toHaveAttribute("aria-valuenow", "180");
  }
  await page.setViewportSize({ width: 500, height: 768 });
  await expect(left).toHaveAttribute("aria-hidden", "true");
  const toggle = page.getByRole("button", { name: "File Tree", exact: true });
  await toggle.click();
  await expect(page.locator(".workspace-drawer-close")).toBeFocused();
  await page.keyboard.press("Escape"); await expect(toggle).toBeFocused();
});

test("renders quiet light and dark workspaces without horizontal overflow", async ({ page }) => {
  await start(page);
  const source = "# Engineering notes · 工程笔记\n\nA focused workspace keeps the document at the center. 宽度变化不应丢失编辑状态。\n\n## Architecture\n\n- Local-first documents\n- Atomic saves and explicit conflicts\n\n| Component | Responsibility |\n| --- | --- |\n| Editor | Markdown and selection |\n| Workspace | Files and persistence |\n\n```typescript\nconst status = 'ready';\n```\n\n## Next steps\n\nReview the changes, then verify the release.\n";
  await page.locator(".cm-content").first().click(); await page.keyboard.insertText(source);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(async (theme) => {
      const module = "/src/features/theme/themeTokens.ts"; (await import(module)).applyThemeTokens(theme);
    }, theme);
    for (const width of [1440, 1024, 760]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 });
      await page.waitForTimeout(100);
      await expect.poll(() => page.locator(".main-layout").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/workspace-${theme}-${width}.png` });
    }
  }
});

test("shows long navigation labels, four sidebar states, settings and mixed resources", async ({ page }) => {
  await start(page);
  const source = "# Workspace quality\n\nA quiet reading surface. 中英文混排与清晰的目录层级。\n\n## Architecture and durable document ownership\n\n```mermaid\ngraph LR\nA[Markdown]-->B[Editor]\nB-->C[Native save]\n```\n\n| Module | Responsibility |\n| --- | --- |\n| Workspace | Revision-aware persistence |\n| Preview | Safe Markdown resources |\n\n![Local sample](assets/polarbear.png)\n";
  await page.evaluate(async (source) => {
    const runtime = (window as any).__TAURI_INTERNALS__, invoke = runtime.invoke;
    const tree = [{ id: "docs", name: "docs", itemType: "folder", children: [
      { id: "docs/Architecture-and-durable-document-ownership.md", name: "Architecture-and-durable-document-ownership.md", itemType: "file" },
      { id: "docs/Meeting.md", name: "Meeting.md", itemType: "file" },
    ] }];
    runtime.invoke = (command: string, args: any) => {
      if (command === "resolve_markdown_asset") return Promise.resolve({ exists: true, assetUrl: "/src-tauri/icons/128x128.png", mimeType: "image/png" });
      if (command === "open_markdown_file") return Promise.resolve({ workspaceRoot: "/test", relativePath: "docs/Architecture-and-durable-document-ownership.md", markdownContent: source, revision: "fixture", tree });
      if (command === "list_workspace_files") return Promise.resolve(tree);
      return invoke(command, args);
    };
    const path = "/src/features/workspace/recentDocuments.ts";
    (await import(path)).recentDocumentStore().record("/test/docs/Architecture-and-durable-document-ownership.md", 1);
  }, source);
  await menuItem(page, /Architecture-and/);
  await expect(page.locator(".cm-content").first()).toContainText("Workspace quality");
  await expect(page.locator('[data-tree-item-id="docs/Architecture-and-durable-document-ownership.md"]')).toBeVisible();
  await expect.poll(() => page.getByAltText("Local sample").evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(128);
  await expect(page.locator(".cm-typora-diagram-preview svg.flowchart")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(async (theme) => { const path = "/src/features/theme/themeTokens.ts"; (await import(path)).applyThemeTokens(theme); }, theme);
    for (const [leftOpen, rightOpen] of [[true, true], [false, true], [false, false], [true, false]]) {
      await page.evaluate(async (layout) => { const path = "/src/shared/settings/userSettings.ts"; await (await import(path)).updateUserSettings({ layout: { leftWidth: 280, rightWidth: 240, ...layout } }); }, { leftOpen, rightOpen });
      await expect(page.locator("#workspace-sidebar")).toHaveAttribute("aria-hidden", String(!leftOpen));
      await expect(page.locator("#workspace-outline")).toHaveAttribute("aria-hidden", String(!rightOpen));
      await expect.poll(() => page.locator(".main-layout").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/workspace-${theme}-${Number(leftOpen)}${Number(rightOpen)}.png` });
    }
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/workspace-settings-${theme}.png` });
    await page.getByRole("button", { name: "Reset Layout", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "240");
    await expect(page.locator("#workspace-outline")).toHaveAttribute("aria-hidden", "true");
  }
});
