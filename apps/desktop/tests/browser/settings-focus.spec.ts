import { expect, test } from "@playwright/test";
import { nativeFixture } from "./fixtures/native";

for (const dismissal of ["Escape", "Close", "backdrop"] as const) {
  test(`returns settings focus to its pointer trigger after ${dismissal}`, async ({ page }) => {
    await nativeFixture(page);
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Settings", exact: true });
    const editor = page.locator(".editor-workspace .cm-content").first();
    await editor.click();
    await page.keyboard.type("Keep this draft.");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    await expect(dialog).toBeVisible();
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else if (dismissal === "Close") await dialog.getByRole("button", { name: "Close", exact: true }).click();
    else await page.mouse.click(4, 4);
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(editor).toContainText("Keep this draft.");
    await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  });
}

test("returns keyboard settings focus to the editor without moving its selection", async ({ page }) => {
  await nativeFixture(page);
  await page.goto("/");
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click();
  await page.keyboard.type("Keep the caret here.");
  await page.keyboard.press("Shift+ArrowLeft");
  const selection = await page.evaluate(() => window.getSelection()?.toString());
  await page.keyboard.press("ControlOrMeta+Comma");
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selection);
});
