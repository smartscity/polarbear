import { expect, test } from "@playwright/test";

const markdown = "Intro\n\n| First | Second |\n| --- | --- |\n| One | Two |\n\nEnd\n";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(() => "__quality" in window);
  await page.evaluate((text) => (window as any).__quality.setDocument("First.md", text), markdown);
  await expect(page.locator(".cm-typora-table-preview table")).toBeVisible();
});

for (const sameContent of [false, true]) test(`does not share table widths between documents at the same offset (identical text: ${sameContent})`, async ({ page }) => {
  // Auto Fit is driven by the hovered column boundary, as in the actual editor.
  const cell = page.locator(".cm-typora-table-preview th").first();
  const box = await cell.boundingBox();
  await page.mouse.move(box!.x + box!.width, box!.y + box!.height - 4);
  await page.locator(".cm-typora-table-resize-handle").evaluate((handle) => handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  await expect.poll(() => page.locator(".cm-typora-table-preview col").first().evaluate((col) => (col as HTMLElement).style.width)).not.toBe("");
  await page.evaluate((text) => (window as any).__quality.setDocument("Second.md", text), sameContent ? markdown : markdown.replace("One", "Other"));
  await expect(page.locator(".cm-typora-table-preview")).toContainText(sameContent ? "One" : "Other");
  await expect.poll(() => page.locator(".cm-typora-table-preview col").first().evaluate((col) => (col as HTMLElement).style.width)).toBe("");
});

test("keeps column widths with a gap insertion through undo and redo", async ({ page }) => {
  const table = page.locator(".cm-typora-table-preview table");
  const cell = table.locator("th").first();
  const box = await cell.boundingBox();
  await page.mouse.move(box!.x + box!.width, box!.y + box!.height - 4);
  await page.locator(".cm-typora-table-resize-handle").dblclick();
  const widths = () => table.locator("col").evaluateAll((columns) => columns.map((col) => (col as HTMLElement).style.width));
  const before = await widths();
  expect(before[0]).not.toBe("");
  const resized = await cell.boundingBox();
  await page.mouse.move(resized!.x + resized!.width, resized!.y + 5);
  await page.locator(".cm-typora-table-gap-column").click();
  await expect(table.locator("col")).toHaveCount(3);
  expect(await widths()).toEqual([before[0], "", before[1]]);
  await page.evaluate(() => (window as any).__quality.undo());
  await expect(table.locator("col")).toHaveCount(2);
  expect(await widths()).toEqual(before);
  await page.evaluate(() => (window as any).__quality.redo());
  await expect(table.locator("col")).toHaveCount(3);
  expect(await widths()).toEqual([before[0], "", before[1]]);
  await page.screenshot({ path: "test-results/table-width-history.png" });
});

test("maps widths when text is inserted before a table and releases them on editor remount", async ({ page }) => {
  const cell = page.locator(".cm-typora-table-preview th").first();
  const box = await cell.boundingBox();
  await page.mouse.move(box!.x + box!.width, box!.y + box!.height - 4);
  await page.locator(".cm-typora-table-resize-handle").evaluate((handle) => handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  const column = page.locator(".cm-typora-table-preview col").first();
  const width = await column.evaluate((col) => (col as HTMLElement).style.width);
  expect(width).not.toBe("");
  await page.evaluate(() => (window as any).__quality.insertText(0, "Prefix\n\n"));
  await expect(page.locator('.cm-typora-table-preview[data-table-key="15"]')).toBeVisible();
  await expect.poll(() => column.evaluate((col) => (col as HTMLElement).style.width)).toBe(width);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect.poll(() => column.evaluate((col) => (col as HTMLElement).style.width)).toBe("");
});

test("cancels the initial table layout frame when controls are disposed immediately", async ({ page }) => {
  const remaining = await page.evaluate(async () => {
    const path = "/src/features/editor/table/tableInteractionDom.ts";
    const { installTableInteractionControls } = await import(path);
    const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
    const pending = new Set<number>(); let next = 0;
    window.requestAnimationFrame = () => { pending.add(++next); return next; };
    window.cancelAnimationFrame = (id) => { pending.delete(id); };
    try {
      const wrapper = document.createElement("div"), table = document.createElement("table");
      const dispose = installTableInteractionControls({ wrapper, table, scrollport: wrapper, rowCount: 0, columnCount: 0,
        onAutoFitColumn() {}, onCommand() {}, onMoveColumn() {}, onMoveRow() {}, onResizeColumn() {} });
      dispose();
      return pending.size;
    } finally { window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel; }
  });
  expect(remaining).toBe(0);
});

test("does not register outside listeners after closing a table menu before its first frame", async ({ page }) => {
  const remaining = await page.evaluate(async () => {
    const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
    const listeners = new Set<EventListenerOrEventListenerObject>();
    document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options: any) => {
      if (type === "pointerdown") listeners.add(listener);
      add(type, listener, options);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options: any) => {
      if (type === "pointerdown") listeners.delete(listener);
      remove(type, listener, options);
    }) as typeof document.removeEventListener;
    try {
      document.querySelector<HTMLButtonElement>(".cm-typora-table-toolbar button")!.click();
      const menu = document.querySelector<HTMLElement>(".cm-typora-table-size-menu")!;
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise(requestAnimationFrame);
      return { listeners: listeners.size, connected: menu.isConnected };
    } finally {
      document.addEventListener = add; document.removeEventListener = remove;
      for (const listener of listeners) remove("pointerdown", listener, true);
    }
  });
  expect(remaining).toEqual({ listeners: 0, connected: false });
});

test("closes table portals when the owning editor is replaced with preview", async ({ page }) => {
  await page.locator(".cm-typora-table-toolbar button").first().evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator(".cm-typora-table-size-menu")).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".cm-typora-table-size-menu")).toHaveCount(0);
});

test("gap insertion restores focus only inside its owning editor", async ({ page }) => {
  await page.evaluate(async (text) => {
    const reactPath = "/node_modules/.vite/deps/react.js";
    const domPath = "/node_modules/.vite/deps/react-dom_client.js";
    const editorPath = "/src/features/editor/components/TyporaLiveEditor.tsx";
    const { default: React } = await import(reactPath), { default: ReactDOM } = await import(domPath);
    const { TyporaLiveEditor } = await import(editorPath);
    const host = document.createElement("div");
    host.id = "second-editor"; host.style.height = "400px";
    document.body.append(host);
    ReactDOM.createRoot(host).render(React.createElement(TyporaLiveEditor, { activeFileId: "Other.md", workspaceRoot: "/other", markdownContent: text }));
  }, markdown);
  const second = page.locator("#second-editor .cm-typora-table-preview");
  await expect(second).toBeVisible();
  const cell = second.locator("th").first();
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  await page.mouse.move(box!.x + box!.width, box!.y + 5);
  await second.locator(".cm-typora-table-gap-column").click();
  await expect(second.locator("th")).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("#second-editor")))).toBe(true);
  await expect(page.locator("#root .cm-typora-table-preview th")).toHaveCount(2);
});
