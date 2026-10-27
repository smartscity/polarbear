import { expect, test } from "@playwright/test";
import { nativeFixture } from "./fixtures/native";

test("leaves Control-Command-F to the native window without searching or changing the draft", async ({ page }) => {
  await nativeFixture(page);
  await page.goto("/");
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click();
  await page.keyboard.insertText("Keep the fullscreen draft.");
  await page.keyboard.press("Shift+ArrowLeft");
  const selection = await page.evaluate(() => window.getSelection()?.toString());
  const prevented = await editor.evaluate((node) => {
    const event = new KeyboardEvent("keydown", {
      key: "f", code: "KeyF", ctrlKey: true, metaKey: true, bubbles: true, cancelable: true,
    });
    node.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.locator(".cm-search")).toHaveCount(0);
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selection);
  await expect(editor).toContainText("Keep the fullscreen draft.");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.locator(".cm-search")).toBeVisible();
});
