import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  await page.addInitScript(() => {
    const state = window as any;
    state.__calls = [];
    const tree = (root: string) => [
      ...(root === "/one" && state.__deleted ? [] : [{ id: "Shared.md", name: "Shared.md", itemType: "file" }]),
      ...(root === "/one" && state.__added ? [{ id: state.__added, name: state.__added, itemType: state.__folder ? "folder" : "file", children: state.__folder ? [] : undefined }] : []),
    ];
    state.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      invoke: async (command: string, args: any = {}) => {
        state.__calls.push({ command, args });
        if (command === "take_pending_open_files") return [];
        if (command === "plugin:dialog|message") return "Yes";
        if (command === "open_markdown_file") {
          const root = args.filePath.slice(0, args.filePath.lastIndexOf("/"));
          return { workspaceRoot: root, relativePath: "Shared.md", markdownContent: args.filePath, revision: "original", tree: tree(root) };
        }
        if (["delete_workspace_entry", "duplicate_workspace_entry", "create_markdown_file", "create_workspace_directory"].includes(command)) {
          return new Promise((resolve, reject) => {
            state.__finishMutation = () => {
              state.__deleted = command === "delete_workspace_entry";
              state.__folder = command === "create_workspace_directory";
              state.__added = state.__deleted ? null : command === "duplicate_workspace_entry" ? "Shared copy.md" : args.relativePath;
              resolve({ newRelativePath: state.__added, deletedRelativePaths: [args.relativePath], warning: state.__syncWarning });
            };
            state.__failMutation = () => reject(new Error("Native mutation failed"));
          });
        }
        if (command === "list_workspace_files") {
          if (state.__failRefresh) throw new Error("Tree refresh failed");
          return tree(args.workspaceRoot);
        }
        if (command === "load_markdown_file") {
          if (state.__failOpen) throw new Error("Open failed");
          return { markdownContent: "# New file", revision: "created" };
        }
        if (command === "plugin:dialog|save") return "/recovered/Recovered.md";
        if (command === "write_markdown_file") return { revision: "recovered" };
        return null;
      },
    };
  });
  await page.goto("/tests/browser/navigation.html?documents");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__documents))).toBe(true);
  await page.evaluate(() => (window as any).__documents.openMarkdownPath("/one/Shared.md"));
}

async function start(page: Page, operation: string) {
  if (operation.startsWith("create")) {
    await page.evaluate((operation) => (window as any).__documents.openCreateDialog(operation === "create file" ? "file" : "folder"), operation);
  }
  await page.evaluate((operation) => {
    const state = window as any, session = state.__documents;
    const pending = operation.startsWith("create") ? session.confirmCreateItem(operation === "create file" ? "New.md" : "New")
      : operation === "delete" ? session.deleteWorkspaceItem("Shared.md") : session.duplicateWorkspaceItem("Shared.md");
    state.__done = false;
    void pending.then(() => { state.__done = true; });
  }, operation);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishMutation)).toBe("function");
}

async function finish(page: Page) {
  await page.evaluate(() => (window as any).__finishMutation());
  await expect.poll(() => page.evaluate(() => (window as any).__done)).toBe(true);
}

for (const operation of ["create file", "create folder", "duplicate", "delete"]) {
  test(`${operation} completion cannot replace another workspace's tree, selection or tabs`, async ({ page }) => {
    await fixture(page);
    await start(page, operation);
    await page.evaluate(() => (window as any).__documents.openMarkdownPath("/two/Shared.md"));
    await page.evaluate(() => (window as any).__documents.updateActiveDocument("Other workspace edits"));
    const id = await page.evaluate(() => (window as any).__documents.activeFileId);
    await finish(page);
    const after = await page.evaluate(() => {
      const s = (window as any).__documents;
      return { root: s.workspaceRoot, active: s.activeFileId, ids: s.openFileIds, text: s.markdownContent,
        dirty: [...s.dirtyFileIds], selected: s.selectedTreeItemId, tree: s.workspaceItems.map((item: any) => item.id) };
    });
    expect(after.root).toBe("/two");
    expect(after.active).toBe(id);
    expect(after.ids).toContain(id);
    expect(after.text).toBe("Other workspace edits");
    expect(after.dirty).toContain(id);
    expect(after.selected).toBe("Shared.md");
    expect(after.tree).toEqual(["Shared.md"]);
  });
}

test("delete retains edits made while native deletion is pending, even if refresh fails", async ({ page }) => {
  await fixture(page);
  const id = await page.evaluate(() => (window as any).__documents.activeFileId);
  await start(page, "delete");
  await page.evaluate(() => (window as any).__documents.updateActiveDocument("Preserve this late edit"));
  await page.evaluate(() => { (window as any).__failRefresh = true; });
  await finish(page);
  const after = await page.evaluate(() => {
    const s = (window as any).__documents;
    return { ids: s.openFileIds, active: s.activeFileId, text: s.markdownContent, dirty: [...s.dirtyFileIds],
      change: s.externalDocumentChange, tree: s.workspaceItems };
  });
  expect(after.ids).toContain(id);
  expect(after.active).toBe(id);
  expect(after.text).toBe("Preserve this late edit");
  expect(after.dirty).toContain(id);
  expect(after.tree).toEqual([]);
  expect(after.change).toMatchObject({ fileId: id, relativePath: "Shared.md", workspaceRoot: "/one", reason: "deleted" });
});

test("recovery saves the deleted document rather than the currently active unrelated tab", async ({ page }) => {
  await fixture(page);
  await start(page, "delete");
  await page.evaluate(() => (window as any).__documents.updateActiveDocument("Recover this deleted document"));
  await page.evaluate(() => (window as any).__documents.openMarkdownPath("/two/Shared.md"));
  await page.evaluate(() => (window as any).__documents.updateActiveDocument("Keep the other document"));
  const other = await page.evaluate(() => (window as any).__documents.activeFileId);
  await finish(page);
  await page.evaluate(() => (window as any).__documents.saveDeletedExternalDocumentAs());
  const writes = await page.evaluate(() => (window as any).__calls.filter((call: any) => call.command === "write_markdown_file"));
  expect(writes).toHaveLength(1);
  expect(writes[0].args.markdownContent).toBe("Recover this deleted document");
  expect(await page.evaluate(() => (window as any).__documents.activeFileId)).toBe(other);
  expect(await page.evaluate(() => (window as any).__documents.markdownContent)).toBe("Keep the other document");
  expect(await page.evaluate(() => (window as any).__documents.externalDocumentChange)).toBeNull();
});

test("deleting the active clean document activates the surviving workspace without applying the old tree", async ({ page }) => {
  await fixture(page);
  const first = await page.evaluate(() => (window as any).__documents.activeFileId);
  await page.evaluate(() => (window as any).__documents.openMarkdownPath("/two/Shared.md"));
  const second = await page.evaluate(() => (window as any).__documents.activeFileId);
  await page.evaluate((id) => (window as any).__documents.activateTab(id), first);
  await start(page, "delete");
  await finish(page);
  expect(await page.evaluate(() => (window as any).__documents.activeFileId)).toBe(second);
  expect(await page.evaluate(() => (window as any).__documents.workspaceRoot)).toBe("/two");
  expect(await page.evaluate(() => (window as any).__documents.workspaceItems.map((item: any) => item.id))).toEqual(["Shared.md"]);
});

test("failed creation leaves the session intact and releases admission for retry", async ({ page }) => {
  await fixture(page);
  const id = await page.evaluate(() => (window as any).__documents.activeFileId);
  await start(page, "create file");
  await page.evaluate(() => (window as any).__failMutation());
  await expect.poll(() => page.evaluate(() => (window as any).__done)).toBe(true);
  await expect(page.locator("output")).toContainText("Native mutation failed");
  expect(await page.evaluate(() => (window as any).__documents.activeFileId)).toBe(id);
  await start(page, "create file");
  await finish(page);
  expect(await page.evaluate(() => (window as any).__documents.activeRelativePath)).toBe("New.md");
});

test("a failed read after creation retains the created tree entry without replacing the current buffer", async ({ page }) => {
  await fixture(page);
  const id = await page.evaluate(() => (window as any).__documents.activeFileId);
  await start(page, "create file");
  await page.evaluate(() => { (window as any).__failOpen = true; });
  await finish(page);
  expect(await page.evaluate(() => (window as any).__documents.activeFileId)).toBe(id);
  expect(await page.evaluate(() => (window as any).__documents.workspaceItems.map((item: any) => item.id))).toContain("New.md");
  await expect(page.locator("output")).toContainText("Created New.md, but it could not be opened");
});

for (const operation of ["duplicate", "delete"]) {
  test(`${operation} preserves disk acknowledgement and reports a failed sync enqueue`, async ({ page }) => {
    await fixture(page);
    await start(page, operation);
    await page.evaluate(() => { (window as any).__syncWarning = "workspace.syncQueueUnavailable"; });
    await finish(page);
    const paths = await page.evaluate(() => (window as any).__documents.workspaceItems.map((item: any) => item.id));
    expect(paths).toEqual(operation === "delete" ? [] : ["Shared.md", "Shared copy.md"]);
    await expect(page.locator("output")).toContainText("Cloud Sync could not queue it");
  });
}

for (const operation of ["create file", "create folder", "duplicate", "delete"]) {
  test(`${operation} commits the tree projection before a failing refresh`, async ({ page }) => {
    await fixture(page);
    await start(page, operation);
    await page.evaluate(() => { (window as any).__failRefresh = true; });
    await finish(page);
    const paths = await page.evaluate(() => (window as any).__documents.workspaceItems.map((item: any) => item.id));
    const added = operation === "create file" ? "New.md" : operation === "create folder" ? "New" : "Shared copy.md";
    expect(paths).toEqual(operation === "delete" ? [] : ["Shared.md", added]);
    if (operation === "delete") {
      expect(await page.evaluate(() => (window as any).__documents.openFileIds)).not.toContain("Shared.md");
    }
    if (operation === "create file") {
      expect(await page.evaluate(() => (window as any).__documents.activeRelativePath)).toBe("New.md");
    }
    await expect(page.locator("output")).toContainText("completed");
  });
}
