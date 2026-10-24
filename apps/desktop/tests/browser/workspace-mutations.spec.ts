import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  await page.addInitScript(() => {
    const state = window as any;
    state.__calls = [];
    state.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      invoke: async (command: string, args: any = {}) => {
        state.__calls.push({ command, args });
        if (command === "take_pending_open_files") return [];
        if (command === "open_markdown_file") return {
          workspaceRoot: args.filePath.slice(0, args.filePath.lastIndexOf("/")), relativePath: "Shared.md",
          markdownContent: args.filePath, revision: "original",
          tree: [{ id: "Shared.md", name: "Shared.md", itemType: "file" }],
        };
        if (command === "rename_entry" || command === "move_entry") return new Promise((resolve, reject) => {
          state.__finishMutation = () => { state.__moved = true; resolve({ oldRelativePath: "Shared.md", newRelativePath: "Renamed.md" }); };
          state.__failMutation = () => reject(new Error("Native mutation failed"));
        });
        if (command === "list_workspace_files") {
          if (state.__failRefresh) throw new Error("Tree refresh failed");
          const name = args.workspaceRoot === "/one" && state.__moved ? "Renamed.md" : "Shared.md";
          return [{ id: name, name, itemType: "file" }];
        }
        if (command === "save_markdown_file") return { revision: "saved" };
        return null;
      },
    };
  });
  await page.goto("/tests/browser/navigation.html?documents");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__documents))).toBe(true);
  await page.evaluate(() => (window as any).__documents.openMarkdownPath("/one/Shared.md"));
}

for (const action of ["rename", "move"]) {
  test(`${action} preserves stable document identity, concurrent edits and another workspace`, async ({ page }) => {
    await fixture(page);
    const id = await page.evaluate(() => (window as any).__documents.activeFileId);
    await page.evaluate((action) => {
      const session = (window as any).__documents;
      void (action === "rename" ? session.confirmRename({ id: "Shared.md" }, "Renamed.md") : session.moveWorkspaceEntry("Shared.md", null));
    }, action);
    await expect.poll(() => page.evaluate(() => typeof (window as any).__finishMutation)).toBe("function");
    await page.evaluate(() => (window as any).__documents.updateActiveDocument("unsaved during mutation"));
    await page.evaluate(() => (window as any).__documents.saveActiveFile());
    expect(await page.evaluate(() => (window as any).__calls.filter((call: any) => call.command === "save_markdown_file"))).toEqual([]);
    await page.evaluate(() => (window as any).__documents.openMarkdownPath("/two/Shared.md"));
    const other = await page.evaluate(() => (window as any).__documents.activeFileId);
    await page.evaluate(() => (window as any).__finishMutation());
    await expect.poll(() => page.evaluate((id) => (window as any).__documents.documentRelativePaths[id], id)).toBe("Renamed.md");
    expect(await page.evaluate((id) => (window as any).__documents.documents[id], id)).toBe("unsaved during mutation");
    expect(await page.evaluate((id) => (window as any).__documents.dirtyFileIds.has(id), id)).toBe(true);
    expect(await page.evaluate((id) => (window as any).__documents.documentRelativePaths[id], other)).toBe("Shared.md");
    expect(await page.evaluate(() => (window as any).__documents.workspaceRoot)).toBe("/two");
    expect(await page.evaluate(() => (window as any).__documents.workspaceItems[0].id)).toBe("Shared.md");
  });
}

test("native success commits identity before a failed tree refresh and blocks duplicate mutations", async ({ page }) => {
  await fixture(page);
  const id = await page.evaluate(() => (window as any).__documents.activeFileId);
  await page.evaluate(() => {
    const state = window as any;
    state.__failRefresh = true;
    void state.__documents.confirmRename({ id: "Shared.md" }, "Renamed.md");
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishMutation)).toBe("function");
  await page.evaluate(() => { void (window as any).__documents.moveWorkspaceEntry("Shared.md", null); });
  expect(await page.evaluate(() => (window as any).__calls.filter((call: any) => ["move_entry", "rename_entry"].includes(call.command)).length)).toBe(1);
  await page.evaluate(() => (window as any).__finishMutation());
  await expect.poll(() => page.evaluate((id) => (window as any).__documents.documentRelativePaths[id], id)).toBe("Renamed.md");
  await page.evaluate(() => (window as any).__documents.saveActiveFile());
  await expect.poll(() => page.evaluate(() => (window as any).__calls.filter((call: any) => call.command === "save_markdown_file").at(-1)?.args.relativePath)).toBe("Renamed.md");
});

test("failed rename preserves identity and releases admission for a retry", async ({ page }) => {
  await fixture(page);
  const id = await page.evaluate(() => (window as any).__documents.activeFileId);
  await page.evaluate(() => { void (window as any).__documents.confirmRename({ id: "Shared.md" }, "Renamed.md"); });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__failMutation)).toBe("function");
  await page.evaluate(() => (window as any).__failMutation());
  await expect(page.locator("output")).toContainText("Native mutation failed");
  expect(await page.evaluate((id) => (window as any).__documents.documentRelativePaths[id], id)).toBe("Shared.md");
  await page.evaluate(() => { void (window as any).__documents.confirmRename({ id: "Shared.md" }, "Renamed.md"); });
  await expect.poll(() => page.evaluate(() => (window as any).__calls.filter((call: any) => call.command === "rename_entry").length)).toBe(2);
  await page.evaluate(() => (window as any).__finishMutation());
  await expect.poll(() => page.evaluate((id) => (window as any).__documents.documentRelativePaths[id], id)).toBe("Renamed.md");
});

test("a pending save excludes rename and a dirty opaque ID is checked by path", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => (window as any).__documents.openMarkdownPath("/two/Shared.md"));
  await page.evaluate(() => (window as any).__documents.updateActiveDocument("dirty second root"));
  await page.evaluate(() => (window as any).__documents.confirmRename({ id: "Shared.md" }, "Renamed.md"));
  expect(await page.evaluate(() => (window as any).__calls.some((call: any) => call.command === "rename_entry"))).toBe(false);
  await page.evaluate(() => {
    const state = window as any, invoke = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = (command: string, args: any) => command === "save_markdown_file"
      ? new Promise((resolve) => { state.__finishSave = () => resolve({ revision: "saved" }); }) : invoke(command, args);
    void state.__documents.saveActiveFile();
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishSave)).toBe("function");
  await page.evaluate(() => (window as any).__documents.moveWorkspaceEntry("Other.md", null));
  expect(await page.evaluate(() => (window as any).__calls.some((call: any) => call.command === "move_entry"))).toBe(false);
  await page.evaluate(() => (window as any).__finishSave());
});
