import { expect, test, type Page } from "@playwright/test";
import windowsPaths from "../fixtures/workspace-relative-paths.json" with { type: "json" };
import { STORAGE_KEYS } from "../../src/shared/constants/storageKeys";

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

for (const action of ["rename", "move"] as const) {
  for (const failRefresh of [false, true]) {
  test(`${action} maps Windows wire paths through nested documents, selection, tree and recents (refresh failure: ${failRefresh})`, async ({ page }) => {
    const from = windowsPaths.paths[0].wire;
    const to = windowsPaths.paths[action === "rename" ? 1 : 2].wire;
    const root = windowsPaths.workspaceRoot;
    await page.addInitScript(({ root, from, to }) => {
      const state = window as any;
      state.__calls = [];
      const tree = (path: string) => {
        const [parent, folder] = path.split("/");
        return [{ id: parent, name: parent, itemType: "folder", children: [
          { id: path, name: folder, itemType: "folder", children: [
            { id: `${path}/first.md`, name: "first.md", itemType: "file" },
            { id: `${path}/deeper`, name: "deeper", itemType: "folder", children: [
              { id: `${path}/deeper/second.md`, name: "second.md", itemType: "file" },
            ] },
          ] },
        ] }, ...(parent === "archive" ? [] : [{ id: "archive", name: "archive", itemType: "folder", children: [] }])];
      };
      state.__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        invoke: async (command: string, args: any = {}) => {
          state.__calls.push({ command, args });
          if (command === "take_pending_open_files") return [];
          if (command === "list_workspace_files") {
            if (state.__failRefresh) throw new Error("Tree refresh failed");
            return tree(state.__moved ? to : from);
          }
          if (command === "load_markdown_file") return { markdownContent: `# ${args.relativePath}`, revision: "original" };
          if (command === "rename_entry" || command === "move_entry") return new Promise((resolve) => {
            if (args.workspaceRoot !== root || args.sourceRelativePath !== from) throw new Error("Path contract mismatch");
            state.__finishMutation = () => { state.__moved = true; resolve({ oldRelativePath: from, newRelativePath: to }); };
          });
          return null;
        },
      };
    }, { root, from, to });
    await page.goto("/tests/browser/navigation.html?documents");
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__documents))).toBe(true);
    await page.evaluate((root) => (window as any).__documents.loadWorkspace(root), root);
    await expect.poll(() => page.evaluate(() => (window as any).__documents.activeRelativePath)).toBe(`${from}/first.md`);
    await page.evaluate((path) => (window as any).__documents.selectFile(path), `${from}/deeper/second.md`);
    await expect.poll(() => page.evaluate(() => (window as any).__documents.activeRelativePath)).toBe(`${from}/deeper/second.md`);
    const before = await page.evaluate(() => {
      const s = (window as any).__documents;
      return { active: s.activeFileId, ids: s.openFileIds, revisions: s.documentRevisions };
    });
    await page.evaluate(({ action, from, failRefresh }) => {
      const state = window as any, s = state.__documents;
      state.__failRefresh = failRefresh;
      void (action === "rename" ? s.confirmRename({ id: from }, "renamed") : s.moveWorkspaceEntry(from, "archive"));
    }, { action, from, failRefresh });
    await expect.poll(() => page.evaluate(() => typeof (window as any).__finishMutation)).toBe("function");
    await page.evaluate(() => (window as any).__documents.updateActiveDocument("Unsaved text during directory mutation"));
    await page.evaluate(() => (window as any).__finishMutation());
    await expect.poll(() => page.evaluate(() => (window as any).__documents.activeRelativePath)).toBe(`${to}/deeper/second.md`);
    const after = await page.evaluate(() => {
      const s = (window as any).__documents;
      return { active: s.activeFileId, ids: s.openFileIds, revisions: s.documentRevisions,
        root: s.workspaceRoot, paths: s.documentRelativePaths, selected: s.selectedTreeItemId,
        text: s.markdownContent, dirty: [...s.dirtyFileIds], tree: s.workspaceItems };
    });
    expect(after.active).toBe(before.active);
    expect(after.ids).toEqual(before.ids);
    expect(after.revisions).toEqual(before.revisions);
    expect(after.root).toBe(root);
    expect(after.selected).toBe(`${to}/deeper/second.md`);
    expect(after.paths).toEqual({ [before.ids[0]]: `${to}/first.md`, [before.ids[1]]: `${to}/deeper/second.md` });
    expect(after.text).toBe("Unsaved text during directory mutation");
    expect(after.dirty).toEqual([before.active]);
    expect(JSON.stringify(after.tree)).toContain(`${to}/deeper/second.md`);
    expect(JSON.stringify(after.tree)).not.toContain(`${from}/`);
    const recent = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), STORAGE_KEYS.recentDocuments);
    expect(recent.map((item: { path: string }) => item.path).sort()).toEqual([
      `${root.replaceAll("\\", "/")}/${to}/first.md`, `${root.replaceAll("\\", "/")}/${to}/deeper/second.md`,
    ].sort());
  });
  }
}
