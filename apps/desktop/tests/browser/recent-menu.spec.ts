import { expect, test, type Page } from "@playwright/test";
import { menuItem, nativeFixture, recentMenuEntries } from "./fixtures/native";

async function record(page: Page, paths: string[]) {
  await page.evaluate(async (paths) => {
    const module = "/src/features/workspace/recentDocuments.ts";
    const store = (await import(module)).recentDocumentStore();
    paths.forEach((path, index) => store.record(path, index + 1));
  }, paths);
}

test("moves the history into File, restores it, distinguishes names and preserves an already open draft", async ({ page }) => {
  await nativeFixture(page); await page.goto("/");
  await expect(page.locator(".recent-documents")).toHaveCount(0);
  await expect(page.locator(".sidebar-bottom")).toHaveCount(0);
  await expect.poll(async () => (await recentMenuEntries(page)).map((item) => [item.text, item.enabled]))
    .toEqual([["No Recent Files", false], ["Clear Recent", false]]);
  await record(page, ["/中文 文件/notes.md", "/other folder/notes.md"]);
  await page.reload();
  await menuItem(page, "notes.md — /中文 文件");
  const editor = page.locator(".editor-workspace .cm-content").first();
  await expect(editor).toContainText("Opened document");
  await editor.click(); await page.keyboard.insertText("Keep this unsaved draft. ");
  await menuItem(page, "notes.md — /other folder");
  await expect(page.locator(".window-tab-title").filter({ hasText: "notes.md" })).toHaveCount(2);
  await menuItem(page, "notes.md — /中文 文件");
  await expect(editor).toContainText("Keep this unsaved draft.");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  await expect(page.locator(".window-tab-title").filter({ hasText: "notes.md" })).toHaveCount(2);
  await expect.poll(async () => (await recentMenuEntries(page))[0]?.text).toBe("notes.md — /中文 文件");
  expect(await page.evaluate(() => (window as any).__navigationCalls.filter((call: any) => call.command === "open_markdown_file").length)).toBe(3);
  await expect(page.locator(".recent-documents")).toHaveCount(0);
});

test("retains unavailable entries and draft contents, then clears only persisted history", async ({ page }) => {
  await nativeFixture(page); await page.goto("/");
  await record(page, ["/test/working.md", "/test/missing.md"]);
  await menuItem(page, "working.md");
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.insertText("Preserve unsaved content. ");
  await menuItem(page, "missing.md");
  await expect(page.locator(".workspace-status")).toContainText("File not found");
  await expect.poll(() => page.evaluate(() => (window as any).__navigationCalls
    .filter((call: any) => call.command === "plugin:dialog|message").at(-1)?.args.message)).toContain("Cannot open missing.md");
  await expect(editor).toContainText("Preserve unsaved content.");
  await expect.poll(async () => (await recentMenuEntries(page)).some((item) => item.text === "missing.md")).toBe(true);
  await menuItem(page, "Clear Recent");
  await expect.poll(async () => (await recentMenuEntries(page)).map((item) => [item.text, item.enabled]))
    .toEqual([["No Recent Files", false], ["Clear Recent", false]]);
  await expect(editor).toContainText("Preserve unsaved content.");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__navigationCalls.some((call: any) => /delete|remove|write_markdown/.test(call.command)))).toBe(false);
  await page.reload();
  await expect.poll(async () => (await recentMenuEntries(page))[0]?.text).toBe("No Recent Files");
});

test("updates translated menus and successful Save As paths while preserving File commands", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__, invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (command === "plugin:dialog|save") return Promise.resolve("/saved/中文 新文件.md");
      if (command === "write_markdown_file") return Promise.resolve({ revision: "saved-revision" });
      return invoke(command, args);
    };
  });
  await page.goto("/");
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.insertText("New document content.");
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect.poll(async () => (await recentMenuEntries(page))[0]?.text).toBe("中文 新文件.md");
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("zh-CN");
  await expect.poll(async () => (await recentMenuEntries(page)).at(-1)?.text).toBe("清除最近记录");
  expect(await page.evaluate(() => {
    const file = (window as any).__nativeMenu.items.find((item: any) => item.id === "file");
    return [file.text, file.items.find((item: any) => item.id === "file.openRecent").text];
  })).toEqual(["文件", "最近打开"]);
  await menuItem(page, "清除最近记录");
  await expect.poll(async () => (await recentMenuEntries(page))[0]?.text).toBe("暂无最近文件");
  await expect(editor).toContainText("New document content.");
});

test("admits one open while a native receipt is pending and cleans history subscriptions on remount", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__, invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (command === "open_markdown_file") return new Promise((resolve) => {
        (window as any).__completeRecentOpen = async () => resolve(await invoke(command, args));
      });
      return invoke(command, args);
    };
  });
  await page.goto("/"); await record(page, ["/test/once.md"]);
  await expect.poll(async () => (await recentMenuEntries(page))[0]?.text).toBe("once.md");
  await page.evaluate(() => {
    const file = (window as any).__nativeMenu.items.find((item: any) => item.id === "file");
    const item = file.items.find((item: any) => item.id === "file.openRecent").items[0];
    item.handler.onmessage(item.id); item.handler.onmessage(item.id);
  });
  await expect.poll(async () => (await recentMenuEntries(page))[0]?.enabled).toBe(false);
  await page.evaluate(() => (window as any).__completeRecentOpen());
  await expect(page.locator(".window-tab-title").filter({ hasText: "once.md" })).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__navigationCalls.filter((call: any) => call.command === "open_markdown_file").length)).toBe(1);
  const balance = await page.evaluate(async () => {
    const reactPath = "/node_modules/.vite/deps/react.js", domPath = "/node_modules/.vite/deps/react-dom_client.js";
    const hookPath = "/src/features/workspace/useRecentDocumentMenu.ts", i18nPath = "/src/shared/i18n/I18nProvider.tsx";
    const React = (await import(reactPath)).default, { createRoot } = (await import(domPath)).default;
    const { useRecentDocumentMenu } = await import(hookPath), { I18nProvider } = await import(i18nPath);
    const added: string[] = [], removed: string[] = [];
    const add = window.addEventListener, remove = window.removeEventListener;
    window.addEventListener = function (type: any, listener: any, options: any) { added.push(type); add.call(this, type, listener, options); };
    window.removeEventListener = function (type: any, listener: any, options: any) { removed.push(type); remove.call(this, type, listener, options); };
    let oldOpen: ((path: string) => void) | undefined, calls = 0;
    function Probe() {
      const menu = useRecentDocumentMenu(async () => { calls++; return true; }, () => {});
      React.useEffect(() => { oldOpen = menu.open; }, [menu.open]);
      return null;
    }
    try {
      for (let n = 0; n < 2; n++) {
        const node = document.createElement("div"); document.body.append(node);
        const root = createRoot(node); root.render(React.createElement(I18nProvider, null, React.createElement(Probe)));
        await new Promise((resolve) => setTimeout(resolve, 100));
        root.unmount(); node.remove(); oldOpen?.("/test/once.md");
      }
    } finally { window.addEventListener = add; window.removeEventListener = remove; }
    return { calls, added: added.filter((s) => s.includes("recent") || s === "storage"), removed: removed.filter((s) => s.includes("recent") || s === "storage") };
  });
  expect(balance.calls).toBe(0);
  expect(balance.added.length).toBeGreaterThanOrEqual(4);
  expect(balance.removed.sort()).toEqual(balance.added.sort());
});
