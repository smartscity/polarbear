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
