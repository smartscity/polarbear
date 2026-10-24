import { expect, test, type Page } from "@playwright/test";

async function nativeFixture(page: Page) {
  await page.addInitScript(() => {
    let captionState = "stopped";
    let captionSource = "system";
    const calls: { command: string; args: Record<string, any> }[] = [];
    Object.assign(window, { __navigationCalls: calls, __TAURI_INTERNALS__: {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      invoke: async (command: string, args: Record<string, any> = {}) => {
        calls.push({ command, args });
        if (command === "take_pending_open_files") return [];
        if (command === "open_markdown_file") {
          if (args.filePath.includes("missing")) throw new Error("File not found");
          const parts = args.filePath.split("/"); const name = parts.pop();
          return { workspaceRoot: parts.join("/"), relativePath: name, markdownContent: "# Opened document\n\nContent.", revision: "fixture", tree: [{ id: name, name, itemType: "file" }] };
        }
        if (command === "list_workspace_files") return [];
        if (command === "caption_request") {
          if (args.request.action === "start") { captionState = "capturing"; captionSource = args.request.source; }
          if (args.request.action === "stop") captionState = "stopped";
          return { state: captionState, source: captionSource, error: null };
        }
        if (command === "memory_admin_request") {
          const config = () => JSON.parse(localStorage.getItem("fixture.context") ?? '{"captureMode":"manual","contextBudgetMode":"auto","defaultContextBudget":2000,"rawEventRetentionDays":30}');
          switch (args.method) {
            case "system.hello": return { apiVersion: "1.0", capabilities: ["projects.status", "memories.list", "memories.get", "projects.config"] };
            case "projects.status": return { project: { id: "fixture", name: "Project" }, counts: {}, recent: [] };
            case "memories.list": return { items: [] };
            case "projects.config": {
              const saved = config();
              await new Promise((resolve) => setTimeout(resolve, 250));
              return saved;
            }
            case "projects.config_update": localStorage.setItem("fixture.context", JSON.stringify(args.params)); return args.params;
          }
        }
        return null;
      },
    } });
  });
}

async function reloadFixture(page: Page) {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__; const invoke = runtime.invoke;
    Object.assign(window, { __diskVersion: "initial", __reads: [] });
    runtime.invoke = (command: string, args: any) => {
      if (command === "repository_get_account") return Promise.resolve({ provider: "github", login: "fixture" });
      if (command === "repository_get_workspace_binding") return Promise.resolve({ provider: "github", owner: "fixture", repo: "fixture", branch: "main", manifest: {} });
      if (command === "repository_sync_now") return Promise.resolve({ conflicts: [] });
      if (command === "get_markdown_file_revision") {
        (window as any).__watchStarted = true;
        return Promise.resolve({ exists: true, watchToken: (window as any).__diskVersion });
      }
      if (command === "list_workspace_files") return Promise.resolve([{ id: "Reload.md", name: "Reload.md", itemType: "file" }]);
      if (command === "load_markdown_file") return new Promise((resolve, reject) => {
        (window as any).__reads.push({ resolve: () => resolve({ markdownContent: "# Stale disk response", revision: "stale" }), reject });
      });
      return invoke(command, args);
    };
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/features/workspace/recentDocuments.ts";
    (await import(path)).recentDocumentStore().record("/test/Reload.md", 1);
  });
  await page.locator(".recent-documents").getByRole("button", { name: /Reload.md/ }).first().click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__watchStarted))).toBe(true);
}

test("native link failure keeps the document and reports a localized error without browser fallback", async ({ page }) => {
  await reloadFixture(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => {
    const runtime = (window as any).__TAURI_INTERNALS__;
    const invoke = runtime.invoke;
    Object.assign(window, { isTauri: true, __externalDialogs: [], __browserOpens: 0 });
    window.open = () => { (window as any).__browserOpens++; return null; };
    runtime.invoke = (command: string, args: any) => {
      if (command === "open_external_url") return Promise.reject("private launcher diagnostic");
      if (command === "plugin:dialog|message") {
        (window as any).__externalDialogs.push(args);
        return Promise.resolve();
      }
      return invoke(command, args);
    };
  });
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("unsaved link test ");
  const original = page.url();
  await page.locator(".designer-credit").click();
  await expect.poll(() => page.evaluate(() => (window as any).__externalDialogs.length)).toBe(1);
  expect(await page.evaluate(() => JSON.stringify((window as any).__externalDialogs))).toContain("The link could not be opened");
  await page.locator(".status-language-select").selectOption("zh-CN");
  await page.locator(".designer-credit").click();
  await expect.poll(() => page.evaluate(() => (window as any).__externalDialogs.length)).toBe(2);
  expect(await page.evaluate(() => JSON.stringify((window as any).__externalDialogs))).toContain("无法打开链接");
  expect(await page.evaluate(() => (window as any).__browserOpens)).toBe(0);
  expect(page.url()).toBe(original);
  await expect(editor).toContainText("unsaved link test");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a blocked browser link never replaces the editor page", async ({ page }) => {
  await reloadFixture(page);
  await page.evaluate(() => {
    Object.assign(window, { isTauri: false, __browserOpens: 0 });
    window.open = () => { (window as any).__browserOpens++; return null; };
  });
  const original = page.url();
  await page.locator(".designer-credit").click();
  await expect.poll(() => page.evaluate(() => (window as any).__browserOpens)).toBe(1);
  expect(page.url()).toBe(original);
  await expect(page.locator(".window-tab-title").filter({ hasText: "Reload.md" })).toHaveCount(1);
});

test("failed credential deletion retains the disconnect command and a successful retry clears it", async ({ page }) => {
  await reloadFixture(page);
  await page.evaluate(async () => {
    const runtime = (window as any).__TAURI_INTERNALS__;
    const invoke = runtime.invoke;
    Object.assign(window, { __disconnects: 0 });
    runtime.invoke = (command: string, args: any) => {
      if (command === "repository_disconnect_provider") {
        if (++(window as any).__disconnects === 1) return Promise.reject(JSON.stringify({
          code: "repository.secretDeletionFailed", message: "private native details",
        }));
        return Promise.resolve();
      }
      return invoke(command, args);
    };
    const path = "/src/shared/settings/userSettings.ts";
    (await import(path)).updateUserSettings({ keybindings: { "repository.disconnectGithub": "Mod+Alt+Shift+D" } });
  });
  await page.locator(".editor-workspace .cm-content").first().click();
  await page.keyboard.press("ControlOrMeta+Alt+Shift+D");
  await expect(page.locator(".workspace-status")).toContainText("Some saved credentials could not be removed");
  await expect(page.locator(".workspace-status")).not.toContainText("Disconnected cloud sync");
  await expect(page.locator(".workspace-status")).not.toContainText("private native details");
  await page.keyboard.press("ControlOrMeta+Alt+Shift+D");
  await expect(page.locator(".workspace-status")).toContainText("Disconnected cloud sync");
  expect(await page.evaluate(() => (window as any).__disconnects)).toBe(2);
});

test("reloaded application can finish pending cleanup without an authenticated account", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__;
    const invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (command === "repository_get_account") {
        return localStorage.getItem("fixture.cleaned") ? Promise.resolve(null) : Promise.reject(JSON.stringify({
          code: "repository.secretDeletionFailed", message: "private native details",
        }));
      }
      if (command === "repository_disconnect_provider") {
        localStorage.setItem("fixture.cleaned", "true");
        return Promise.resolve();
      }
      return invoke(command, args);
    };
  });
  await page.goto("/");
  await expect(page.locator(".workspace-status")).toContainText("Some saved credentials could not be removed");
  await page.evaluate(async () => {
    const path = "/src/shared/settings/userSettings.ts";
    (await import(path)).updateUserSettings({ keybindings: { "repository.disconnectGithub": "Mod+Alt+Shift+D" } });
  });
  await page.reload();
  await expect(page.locator(".workspace-status")).toContainText("Some saved credentials could not be removed");
  await page.keyboard.press("ControlOrMeta+Alt+Shift+D");
  await expect(page.locator(".workspace-status")).toContainText("Disconnected cloud sync");
  expect(await page.evaluate(() => localStorage.getItem("fixture.cleaned"))).toBe("true");
  await page.reload();
  await expect(page.locator(".editor-workspace .cm-content").first()).toBeVisible();
  await expect(page.locator(".workspace-status")).toHaveCount(0);
});

test("preserves typing during an external reload and offers an explicit conflict choice", async ({ page }) => {
  await reloadFixture(page);
  await page.evaluate(() => { (window as any).__diskVersion = "changed"; });
  await expect.poll(() => page.evaluate(() => (window as any).__reads.length)).toBe(1);
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("new unsaved words ");
  await page.evaluate(() => (window as any).__reads[0].resolve());
  await expect(editor).toContainText("new unsaved words");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Reload from Disk", exact: true })).toBeVisible();
});

async function pendingKnowledgeSource(page: Page) {
  await reloadFixture(page);
  await page.evaluate(() => {
    const runtime = (window as any).__TAURI_INTERNALS__;
    const invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (command === "memory_admin_request") {
        if (args.method === "system.hello") return Promise.resolve({
          apiVersion: "1.0", capabilities: ["projects.status", "memories.list", "memories.get",
            "projects.context", "sources.register", "sources.resolve", "knowledge.capture", "knowledge.search", "knowledge.review"],
        });
        if (args.method === "knowledge.search") return Promise.resolve({
          items: [{ card: { id: "source", revision: 1, answer: "Document source", appliesWhen: "Reading", reason: "Evidence" }, decision: "REUSABLE", reasonCodes: [] }],
          reviewNotices: [], excludedCounts: {}, partial: false,
        });
        if (args.method === "sources.resolve") return Promise.resolve({
          decision: "REUSABLE", source: { relativePath: "Reload.md" },
          observedSection: { locator: { startLine: 1, endLine: 1 }, excerpt: "# Stale disk response" },
        });
      }
      return invoke(command, args);
    };
  });
  await page.locator(".activity-rail button").nth(1).click();
  await page.getByRole("button", { name: "Knowledge", exact: true }).click();
  await page.getByRole("textbox", { name: "Related question" }).fill("source");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Open source", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__reads.length)).toBe(1);
  await page.locator(".activity-rail button").first().click();
}

test("preserves typing while Memory opens the source of an already open document", async ({ page }) => {
  await pendingKnowledgeSource(page);
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("new source edits ");
  await page.evaluate(() => (window as any).__reads[0].resolve());
  await expect(page.getByRole("button", { name: "Reload from Disk", exact: true })).toBeVisible();
  await expect(editor).toContainText("new source edits");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
});

test("does not reopen a closed document when a Memory source read finishes", async ({ page }) => {
  await pendingKnowledgeSource(page);
  await page.getByRole("button", { name: "Close Reload.md", exact: true }).click();
  await page.evaluate(() => (window as any).__reads[0].resolve());
  await expect(page.locator(".workspace-status")).toContainText("Closed");
  await expect(page.locator(".window-tab-title").filter({ hasText: "Reload.md" })).toHaveCount(0);
});

test("refreshes and selects an unchanged Memory source document", async ({ page }) => {
  await pendingKnowledgeSource(page);
  await page.evaluate(() => (window as any).__reads[0].resolve());
  await expect(page.locator(".editor-workspace .cm-content").first()).toContainText("Stale disk response");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toContain("Stale disk response");
});

test("does not apply an old disk read to a closed and reopened document", async ({ page }) => {
  await reloadFixture(page);
  await page.evaluate(() => { (window as any).__diskVersion = "changed"; });
  await expect.poll(() => page.evaluate(() => (window as any).__reads.length)).toBe(1);
  await page.getByRole("button", { name: "Close Reload.md", exact: true }).click();
  await page.locator(".recent-documents").getByRole("button", { name: /Reload.md/ }).first().click();
  await page.evaluate(() => (window as any).__reads[0].resolve());
  await expect(page.locator(".workspace-status")).not.toContainText("Reloaded");
  await expect(page.locator(".editor-workspace .cm-content").first()).toContainText("Opened document");
});

test("cancels a pending explicit reload when the user chooses to keep editing", async ({ page }) => {
  await reloadFixture(page);
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("keep these words ");
  await page.evaluate(() => { (window as any).__diskVersion = "changed"; });
  await page.getByRole("button", { name: "Reload from Disk", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__reads.length)).toBe(1);
  await page.getByRole("button", { name: "Keep Editing", exact: true }).click();
  await page.evaluate(() => (window as any).__reads[0].resolve());
  await expect(editor).toContainText("keep these words");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
});

test("preserves edits made while synchronization reloads a clean document", async ({ page }) => {
  await reloadFixture(page);
  const editor = page.locator(".editor-workspace .cm-content").first();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__reads.length)).toBe(1);
  await editor.click(); await page.keyboard.type("typed during reload ");
  await page.evaluate(() => (window as any).__reads[0].resolve());
  await expect(page.locator(".repository-operation-toast")).toHaveCount(0);
  await expect(editor).toContainText("typed during reload");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Reload from Disk", exact: true })).toBeVisible();
  await expect(page.locator(".workspace-status")).toContainText("local edits were kept");
});

test("reloads an accepted dirty snapshot and clears only its dirty marker", async ({ page }) => {
  await reloadFixture(page);
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("discard this snapshot ");
  await page.evaluate(() => { (window as any).__diskVersion = "changed"; });
  await page.getByRole("button", { name: "Reload from Disk", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__reads.length)).toBe(1);
  await page.evaluate(() => (window as any).__reads[0].resolve());
  await expect(page.getByRole("button", { name: "Reload from Disk", exact: true })).toHaveCount(0);
  await expect(editor).toContainText("Stale disk response");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(0);
  await expect(page.locator(".workspace-status")).toContainText("Reloaded Reload.md");
});

test("reports sync reload failures without declaring success or changing the buffer", async ({ page }) => {
  await reloadFixture(page);
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__reads.length)).toBe(1);
  await page.evaluate(() => (window as any).__reads[0].reject(new Error("Disk read denied")));
  await expect(page.locator(".workspace-status")).toContainText("Disk read denied");
  await expect(page.locator(".repository-operation-toast")).toHaveCount(0);
  await expect(page.locator(".editor-workspace .cm-content").first()).toContainText("Opened document");
});

test("ignores read errors from a closed document", async ({ page }) => {
  await reloadFixture(page);
  await page.evaluate(() => { (window as any).__diskVersion = "changed"; });
  await expect.poll(() => page.evaluate(() => (window as any).__reads.length)).toBe(1);
  await page.getByRole("button", { name: "Close Reload.md", exact: true }).click();
  await page.evaluate(() => (window as any).__reads[0].reject(new Error("Obsolete error")));
  await expect(page.locator(".workspace-status")).toContainText("Closed");
  await expect(page.locator(".workspace-status")).not.toContainText("Obsolete error");
});

test("retains edits made while a document save is pending", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__;
    const invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (command === "save_markdown_file") return new Promise((resolve) => {
        (window as any).__saveCount = ((window as any).__saveCount ?? 0) + 1;
        (window as any).__pendingSave = { args, resolve: () => resolve({ revision: "saved-first" }) };
      });
      return invoke(command, args);
    };
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/features/workspace/recentDocuments.ts";
    (await import(path)).recentDocumentStore().record("/test/Save.md", 1);
  });
  await page.locator(".recent-documents").getByRole("button", { name: /Save.md/ }).first().click();
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" first edit");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => page.evaluate(() => !!(window as any).__pendingSave)).toBe(true);
  await page.keyboard.press("ControlOrMeta+s");
  expect(await page.evaluate(() => (window as any).__saveCount)).toBe(1);
  await page.keyboard.type(" newer unsaved edit");
  await page.evaluate(() => (window as any).__pendingSave.resolve());
  await expect(page.locator(".workspace-status")).toContainText(/Saved|saved/);
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  await expect(editor).toContainText("newer unsaved edit");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => page.evaluate(() => (window as any).__pendingSave.args.expectedRevision)).toBe("saved-first");
  await page.evaluate(() => (window as any).__pendingSave.resolve());
  await expect(page.locator(".window-tab-dirty")).toHaveCount(0);
});

test("preserves newer text and its dirty state when Save As replaces the document identity", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__; const invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (command === "plugin:dialog|save") return Promise.resolve("/test/Renamed.md");
      if (command === "write_markdown_file") return new Promise((resolve) => {
        (window as any).__pendingSaveAs = () => resolve({ revision: "saved-as" });
      });
      return invoke(command, args);
    };
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/features/workspace/recentDocuments.ts";
    (await import(path)).recentDocumentStore().record("/test/Original.md", 1);
  });
  await page.locator(".recent-documents").getByRole("button", { name: /Original.md/ }).first().click();
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" before save as");
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect.poll(() => page.evaluate(() => !!(window as any).__pendingSaveAs)).toBe(true);
  await page.keyboard.type(" after save as");
  await page.evaluate(() => (window as any).__pendingSaveAs());
  await expect(page.locator(".window-tab-title").filter({ hasText: "Renamed.md" })).toBeVisible();
  await expect(editor).toContainText("after save as");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
});

test("keeps the document open and dirty when saving before close is denied", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__; const invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (command === "plugin:dialog|message") return Promise.resolve("Yes");
      if (command === "save_markdown_file") return Promise.reject({ code: "workspace.permissionDenied", message: "EACCES" });
      return invoke(command, args);
    };
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/features/workspace/recentDocuments.ts";
    (await import(path)).recentDocumentStore().record("/test/Private.md", 1);
  });
  await page.locator(".recent-documents").getByRole("button", { name: /Private.md/ }).first().click();
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("pending text ");
  await page.getByRole("button", { name: "Close Private.md", exact: true }).click();
  await expect(page.locator(".workspace-status")).toContainText("not writable");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  await expect(editor).toContainText("pending text");
});

test("acknowledges a local save with a sync warning and reuses its revision", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__; const invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (command === "save_markdown_file") {
        (window as any).__lastSave = args;
        return Promise.resolve({ revision: "locally-committed", warning: "workspace.syncQueueUnavailable" });
      }
      return invoke(command, args);
    };
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/features/workspace/recentDocuments.ts";
    (await import(path)).recentDocumentStore().record("/test/Local.md", 1);
  });
  await page.locator(".recent-documents").getByRole("button", { name: /Local.md/ }).first().click();
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("first edit ");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(0);
  await expect(page.locator(".workspace-status")).toContainText("sync queue");
  await page.keyboard.type("second edit "); await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => page.evaluate(() => (window as any).__lastSave.expectedRevision)).toBe("locally-committed");
  await expect(editor).toContainText("second edit");
});

test("does not start a second save or synchronize while a document save is pending", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__; const invoke = runtime.invoke;
    Object.assign(window, { __saveCount: 0, __remoteSyncCount: 0 });
    runtime.invoke = (command: string, args: any) => {
      if (command === "repository_get_account") return Promise.resolve({ provider: "github", login: "fixture" });
      if (command === "repository_get_workspace_binding") return Promise.resolve({ provider: "github", owner: "fixture", repo: "fixture", branch: "main", manifest: {} });
      if (command === "repository_sync_now") { (window as any).__remoteSyncCount++; return Promise.resolve({ conflicts: [] }); }
      if (command === "save_markdown_file") {
        (window as any).__saveCount++;
        return new Promise((resolve) => { (window as any).__finishSave = () => resolve({ revision: "saved" }); });
      }
      return invoke(command, args);
    };
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/features/workspace/recentDocuments.ts";
    (await import(path)).recentDocumentStore().record("/test/Sync.md", 1);
  });
  await page.locator(".recent-documents").getByRole("button", { name: /Sync.md/ }).first().click();
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("pending sync edit ");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => page.evaluate(() => (window as any).__saveCount)).toBe(1);
  await page.keyboard.press("ControlOrMeta+Alt+s");
  await expect(page.locator(".workspace-status")).toContainText("Sync paused");
  expect(await page.evaluate(() => (window as any).__saveCount)).toBe(1);
  expect(await page.evaluate(() => (window as any).__remoteSyncCount)).toBe(0);
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  await page.evaluate(() => (window as any).__finishSave());
  await expect(page.locator(".window-tab-dirty")).toHaveCount(0);
});

test("retains the current document when a file-tree read fails", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__; const invoke = runtime.invoke;
    runtime.invoke = async (command: string, args: any) => {
      if (command === "open_markdown_file") {
        const result = await invoke(command, args);
        result.tree.push({ id: "Unavailable.md", name: "Unavailable.md", itemType: "file" });
        return result;
      }
      if (command === "load_markdown_file") throw new Error("Read permission denied");
      if (command === "list_workspace_files") return [
        { id: "Working.md", name: "Working.md", itemType: "file" },
        { id: "Unavailable.md", name: "Unavailable.md", itemType: "file" },
      ];
      return invoke(command, args);
    };
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/features/workspace/recentDocuments.ts";
    (await import(path)).recentDocumentStore().record("/test/Working.md", 1);
  });
  await page.locator(".recent-documents").getByRole("button", { name: /Working.md/ }).first().click();
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("important unsaved text ");
  await page.locator('[data-tree-item-id="Unavailable.md"]').click();
  await expect(page.locator(".workspace-status")).toContainText("Read permission denied");
  await expect(editor).toContainText("important unsaved text");
  await expect(page.locator(".window-tab-title").filter({ hasText: "Unavailable.md" })).toHaveCount(0);
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
});

test("ignores an old recent-file completion after a new tab is created", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__; const invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (command === "open_markdown_file" && args.filePath.endsWith("Slow.md")) {
        return new Promise((resolve) => { (window as any).__finishOpen = async () => resolve(await invoke(command, args)); });
      }
      return invoke(command, args);
    };
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/features/workspace/recentDocuments.ts";
    const store = (await import(path)).recentDocumentStore();
    store.record("/test/Slow.md", 1);
  });
  const recent = page.locator(".recent-documents");
  await recent.getByRole("button", { name: /Slow.md/ }).first().click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__finishOpen)).toBe(true);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("newer document text ");
  await page.evaluate(() => (window as any).__finishOpen());
  await expect(editor).toContainText("newer document text");
  await expect(page.locator(".window-tab-title").filter({ hasText: "Slow.md" })).toHaveCount(0);
  await expect(recent.getByRole("alert")).toHaveCount(0);
});

test("does not discard unsaved text when opening another workspace", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__; const invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (command === "plugin:dialog|open") return Promise.resolve("/next-workspace");
      return invoke(command, args);
    };
  });
  await page.goto("/");
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click(); await page.keyboard.type("unsaved workspace draft");
  await page.locator('.workspace-empty, .workspace-tree-shell').first().click({ button: "right" });
  await page.getByRole("button", { name: "OPEN A FOLDER", exact: true }).click();
  await expect(page.locator(".workspace-status")).toContainText("Save or close");
  await expect(editor).toContainText("unsaved workspace draft");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
});

test("opens Workspace on launch and reload even after visiting Context", async ({ page }) => {
  await nativeFixture(page); await page.goto("/");
  await expect(page.locator(".activity-rail button").first()).toHaveAttribute("aria-pressed", "true", { timeout: 15000 });
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.locator(".activity-rail button").nth(1).click();
  await expect(page.locator(".context-workspace")).toBeVisible();
  await page.reload();
  await expect(page.locator(".activity-rail button").first()).toHaveAttribute("aria-pressed", "true");
});

test("reopens recent documents through native access and retains unavailable entries for removal", async ({ page }) => {
  await nativeFixture(page); await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/features/workspace/recentDocuments.ts";
    const { recentDocumentStore } = await import(path);
    recentDocumentStore().record("/test/Article.md", 1);
    recentDocumentStore().record("/test/missing.md", 2);
  });
  const recent = page.locator(".recent-documents");
  await recent.getByRole("button", { name: /Article.md/ }).first().click();
  await expect(page.locator(".editor-workspace")).toContainText("Opened document");
  await expect(recent.locator("li").first()).toContainText("Article.md");
  await page.reload();
  await expect(recent.locator("li")).toHaveCount(2);
  await recent.getByRole("button", { name: /missing.md/ }).first().click();
  await expect(page.locator(".workspace-status")).toContainText("File not found");
  await page.screenshot({ path: "test-results/workspace-operation-feedback.png" });
  await expect(recent.getByRole("alert")).toContainText("Cannot open missing.md");
  await recent.getByRole("button", { name: "Remove missing.md from history", exact: true }).click();
  await expect(recent.locator("li")).toHaveCount(1);
  await recent.getByRole("button", { name: "Clear history" }).click();
  await page.reload(); await expect(recent).toContainText("No recently opened documents");
});

test("keeps Context edits across refresh and persists confirmed settings across remount and reload", async ({ page }) => {
  await nativeFixture(page); await page.goto("/tests/browser/navigation.html");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const save = page.getByRole("button", { name: "Save settings" });
  await expect(save).toBeDisabled();
  const custom = page.getByRole("radio", { name: "Custom", exact: true });
  await expect(custom).toBeEnabled();
  await custom.check();
  await page.getByRole("spinbutton", { name: /Custom/ }).fill("3456");
  await page.getByRole("combobox", { name: "Capture mode" }).selectOption("off");
  await page.getByRole("button", { name: "Refresh Context", exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(page.getByRole("spinbutton", { name: /Custom/ })).toHaveValue("3456");
  await save.click(); await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Switch surface" }).click();
  await page.getByRole("button", { name: "Switch surface" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(custom).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Capture mode" })).toHaveValue("off");
  await page.reload(); await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: /Custom/ })).toHaveValue("3456");
});

test("keeps settings aligned, persisted and synchronized with caption state in both themes", async ({ page }) => {
  await nativeFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const translation = dialog.getByRole("switch", { name: "Selection translation" });
  await translation.uncheck();
  const source = dialog.getByRole("combobox", { name: "Audio source" });
  await expect(source).toBeEnabled(); await source.selectOption("microphone");
  const caption = dialog.getByRole("switch", { name: "Enable Live Caption" });
  await caption.check(); await expect(source).toBeDisabled();
  await caption.uncheck(); await expect(source).toBeEnabled();
  await dialog.getByRole("button", { name: "Caption history", exact: true }).click();
  await expect(caption).not.toBeChecked();
  await page.keyboard.press("Escape"); await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(translation).not.toBeChecked(); await expect(source).toHaveValue("microphone");
  await expect(caption).not.toBeChecked();
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(async (theme) => { const path = "/src/features/theme/themeTokens.ts"; (await import(path)).applyThemeTokens(theme); }, theme);
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 760 });
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
      await page.screenshot({ path: `test-results/settings-${theme}-${width}.png` });
    }
  }
  await page.evaluate(async () => { const path = "/src/shared/settings/userSettings.ts"; (await import(path)).updateUserSettings({ language: "zh-CN" }); });
  const localized = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(localized.getByRole("switch", { name: "开启实时字幕" })).toBeVisible();
  expect(await localized.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/settings-zh-narrow.png" });
});

test("does not replace system preferences on startup and receives changes from another window", async ({ page, context }) => {
  await nativeFixture(page); await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("polarbear.settings", JSON.stringify({ version: 3, theme: "system", language: "system", selectionTranslation: false }));
    localStorage.setItem("polarbear.theme", "dark"); localStorage.setItem("polarbear-language", "zh-CN");
  });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const translation = page.getByRole("switch", { name: "Selection translation" });
  await expect(translation).not.toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("polarbear.settings")!).theme)).toBe("system");
  const other = await context.newPage();
  await nativeFixture(other); await other.goto("/");
  await other.evaluate(async () => {
    const path = "/src/shared/settings/userSettings.ts";
    (await import(path)).updateUserSettings({ selectionTranslation: true });
  });
  await expect(translation).toBeChecked();
  await other.close();
});

test("blocks default Context writes when saved configuration cannot be read", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__;
    const invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (args?.method === "system.hello") return Promise.resolve({ apiVersion: "1.0", capabilities: ["projects.status", "memories.list", "memories.get"] });
      return invoke(command, args);
    };
  });
  await page.goto("/tests/browser/navigation.html");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Project settings are not available");
  await expect(page.getByRole("button", { name: "Save settings" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Custom", exact: true })).toBeDisabled();
});

test("retains Context drafts after a rejected save and does not report persistence", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__; const invoke = runtime.invoke;
    runtime.invoke = (command: string, args: any) => {
      if (args?.method === "projects.config_update") return Promise.reject(new Error("Configuration write failed"));
      return invoke(command, args);
    };
  });
  await page.goto("/tests/browser/navigation.html");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Capture mode" }).selectOption("off");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("alert")).toContainText("Configuration write failed");
  await expect(page.getByRole("combobox", { name: "Capture mode" })).toHaveValue("off");
  await expect(page.getByRole("button", { name: "Save settings" })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("fixture.context"))).toBeNull();
});

test("rejects an older refresh response after a newer Context save", async ({ page }) => {
  await nativeFixture(page); await page.goto("/tests/browser/navigation.html?probe");
  await expect(page.locator("output")).toContainText('"captureMode":"manual"');
  await page.evaluate(async () => {
    const session = (window as any).__contextSession;
    const refresh = session.refresh();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await session.updateConfig({ ...session.config, captureMode: "off" });
    await refresh;
  });
  await expect(page.locator("output")).toContainText('"captureMode":"off"');
  await page.reload();
  await expect(page.locator("output")).toContainText('"captureMode":"off"');
});

test("discards a pending Context save when switching to another workspace", async ({ page }) => {
  await nativeFixture(page); await page.goto("/tests/browser/navigation.html?probe");
  await expect(page.locator("output")).toContainText('"captureMode":"manual"');
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => args?.method === "projects.config_update"
      ? new Promise((resolve) => { w.__finishSave = () => resolve(args.params); }) : invoke(command, args);
    w.__pendingSave = w.__contextSession.updateConfig({ ...w.__contextSession.config, captureMode: "off" });
    w.__selectWorkspace("/test/other");
  });
  await expect(page.locator("output")).toContainText('"loading":false');
  await page.evaluate(async () => { const w = window as any; w.__finishSave(); await w.__pendingSave; });
  await expect(page.locator("output")).toContainText('"captureMode":"manual"');
  await expect(page.locator("output")).toContainText('"mutating":false');
});

test("keeps Context busy until every current operation finishes", async ({ page }) => {
  await nativeFixture(page); await page.goto("/tests/browser/navigation.html?probe");
  await expect(page.locator("output")).toContainText('"captureMode":"manual"');
  await page.evaluate(() => {
    const w = window as any; const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__finishes = [];
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => args?.method === "memories.history"
      ? new Promise((resolve) => w.__finishes.push(() => resolve({ items: [] }))) : invoke(command, args);
    w.__first = w.__contextSession.loadMemoryHistory("a");
    w.__second = w.__contextSession.loadMemoryHistory("b");
  });
  await expect(page.locator("output")).toContainText('"mutating":true');
  await page.evaluate(async () => { const w = window as any; w.__finishes[0](); await w.__first; });
  await expect(page.locator("output")).toContainText('"mutating":true');
  await page.evaluate(async () => { const w = window as any; w.__finishes[1](); await w.__second; });
  await expect(page.locator("output")).toContainText('"mutating":false');
});

test("does not carry an unsaved Context draft into a different workspace", async ({ page }) => {
  await nativeFixture(page); await page.goto("/tests/browser/navigation.html");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Capture mode" }).selectOption("off");
  await expect(page.getByRole("button", { name: "Save settings" })).toBeEnabled();
  await page.getByRole("button", { name: "Switch workspace", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Capture mode" })).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "Capture mode" })).toHaveValue("manual");
  await expect(page.getByRole("button", { name: "Save settings" })).toBeDisabled();
});
