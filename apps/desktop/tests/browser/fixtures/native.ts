import { expect, type Page } from "@playwright/test";

export async function menuItem(page: Page, label: string | RegExp) {
  const query = typeof label === "string" ? { text: label } : { pattern: label.source };
  const find = (query: { text?: string; pattern?: string; activate?: boolean }) => {
    const visit = (items: any[]): any => {
      for (const item of items) {
        if ((query.text ? item.text === query.text : new RegExp(query.pattern!).test(item.text ?? "")) && item.handler) return item;
        const found = item.items && visit(item.items);
        if (found) return found;
      }
    };
    const item = visit((window as any).__nativeMenu?.items ?? []);
    if (query.activate && item?.enabled !== false) item?.handler.onmessage(item.id);
    return Boolean(item && item.enabled !== false);
  };
  await expect.poll(() => page.evaluate(find, query)).toBe(true);
  await page.evaluate(find, { ...query, activate: true });
}

export async function recentMenuEntries(page: Page): Promise<{ id: string; text: string; enabled: boolean }[]> {
  return page.evaluate(() => {
    const file = (window as any).__nativeMenu?.items?.find((item: any) => item.id === "file");
    return (file?.items?.find((item: any) => item.id === "file.openRecent")?.items ?? [])
      .filter((item: any) => item.id).map((item: any) => ({ id: item.id, text: item.text, enabled: item.enabled !== false }));
  });
}

export async function nativeFixture(page: Page) {
  await page.addInitScript(() => {
    let captionState = "stopped";
    let captionSource = "system";
    let menuId = 0;
    const menus = new Map<number, any>();
    const calls: { command: string; args: Record<string, any> }[] = [];
    Object.assign(window, { __navigationCalls: calls,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
      __TAURI_INTERNALS__: {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      invoke: async (command: string, args: Record<string, any> = {}) => {
        calls.push({ command, args });
        if (command === "plugin:menu|new") {
          const rid = ++menuId; menus.set(rid, args.options); return [rid, `fixture-menu-${rid}`];
        }
        if (command === "plugin:menu|set_as_app_menu") {
          (window as any).__nativeMenu = menus.get(args.rid); return null;
        }
        if (command === "plugin:resources|close") { menus.delete(args.rid); return null; }
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
