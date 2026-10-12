import { test, expect } from "@playwright/test";

test("opens cold and warm native deliveries directly and recovers after an import error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    type Entry = { collection: string; path: string; importedAt: number };
    type Item = { id: number; entries: Entry[]; error: string | null };
    let sequence = 0;
    let callbackId = 0;
    let pending: Item[] = [];
    const entries: Entry[] = [];
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Set<number>();
    const send = (name: string, error: string | null = null) => {
      const entry = { collection: String(++sequence), path: `${name}.md`, importedAt: sequence };
      if (!error) entries.push(entry);
      pending.push({ id: sequence, entries: error ? [] : [entry], error });
      for (const id of listeners) callbacks.get(id)?.({ event: "reader://document-opened", id, payload: null });
    };
    Object.assign(window, {
      isTauri: true,
      __readerTestSend: send,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => listeners.delete(id) },
      __TAURI_INTERNALS__: {
        transformCallback: (callback: (event: unknown) => void) => { callbacks.set(++callbackId, callback); return callbackId; },
        invoke: async (command: string, args: { handler?: number; id?: number; path?: string } = {}) => {
          switch (command) {
            case "plugin:event|listen": listeners.add(args.handler!); return args.handler;
            case "plugin:event|unlisten": return;
            case "plugin:reader|pending_open_documents": return [...pending];
            case "plugin:reader|acknowledge_open_document": pending = pending.filter((item) => item.id !== args.id); return;
            case "plugin:reader|listDocuments": return { entries: [...entries] };
            case "plugin:reader|readDocument": return { content: `# ${args.path?.replace(/\.md$/, "")}\n\nOpened through the native inbox.` };
            default: throw new Error(`Unexpected native command: ${command}`);
          }
        },
      },
    });
    send("Cold document");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Cold document", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.evaluate(() => (window as unknown as { __readerTestSend: (name: string) => void }).__readerTestSend("Warm 中文 document"));
  await expect(page.getByRole("heading", { name: "Warm 中文 document", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __readerTestSend: (name: string, error: string) => void }).__readerTestSend("Invalid", "invalidEncoding"));
  await expect(page.getByRole("alert")).toContainText("not valid UTF-8");
  await page.evaluate(() => (window as unknown as { __readerTestSend: (name: string) => void }).__readerTestSend("Next document"));
  await expect(page.getByRole("heading", { name: "Next document", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.locator(".book-list li")).toHaveCount(3);
  expect(errors).toEqual([]);
});
