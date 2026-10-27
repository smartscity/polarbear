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

test("resynchronizes the editor selection after native fullscreen focus restoration", async ({ page }) => {
  await nativeFixture(page);
  await page.goto("/");
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click();
  await page.keyboard.insertText("First line\nLast word");
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("d");
  await editor.evaluate((node) => {
    // AppKit can restore the native responder without restoring WebKit's range.
    window.getSelection()?.collapse(node.firstChild!, 0);
    window.dispatchEvent(new Event("polarbear-native-fullscreen-restored"));
  });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("d");
  await page.keyboard.insertText("D");
  await expect(editor).toContainText("Last worD");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).toContainText("Last word");
});

test("does not redirect native fullscreen recovery from Find to the editor", async ({ page }) => {
  await nativeFixture(page);
  await page.goto("/");
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click();
  await page.keyboard.insertText("Keep this draft.");
  await page.keyboard.press("ControlOrMeta+f");
  const search = page.locator(".cm-search input[name=search]");
  await search.fill("Keep");
  await page.evaluate(() => window.dispatchEvent(new Event("polarbear-native-fullscreen-restored")));
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Keep");
  await expect(editor).toHaveText("Keep this draft.");
});
