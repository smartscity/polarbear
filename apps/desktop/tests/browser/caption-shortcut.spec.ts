import { expect, test } from "@playwright/test";

test("activates captions from the editor and keeps the settings hint aligned with overrides", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: { action: string; source?: string }[] = [];
    Object.assign(window, { __captionCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args: { request?: { action: string; source?: string } }) => {
        if (command !== "caption_request" || !args.request) return;
        calls.push(args.request);
        if (args.request.action === "status") return { state: "stopped", source: "microphone" };
      },
    } });
  });
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(() => "__quality" in window);
  await page.evaluate(async () => {
    const path = "/src/shared/settings/userSettings.ts";
    const { updateUserSettings } = await import(path);
    await updateUserSettings({ caption: { source: "microphone" } });
  });
  await page.locator(".cm-content").click();
  const before = await page.locator(".cm-content").innerText();
  const primary = await page.evaluate(() => /mac|iphone|ipad/i.test(navigator.platform) ? "Meta" : "Control");
  const starts = () => page.evaluate(() => (window as unknown as { __captionCalls: { action: string; source?: string }[] }).__captionCalls.filter(call => call.action === "start"));
  await page.keyboard.press(`${primary}+Alt+l`);
  await expect.poll(starts).toEqual([{ action: "start", source: "microphone", timezone: expect.any(String) }]);
  await page.keyboard.press(`${primary}+Alt+l`);
  await expect.poll(async () => (await starts()).length).toBe(2);
  expect(await page.locator(".cm-content").innerText()).toBe(before);
  expect(await page.evaluate(() => (window as unknown as { __captionCalls: { action: string }[] }).__captionCalls.some(call => ["stop", "resume"].includes(call.action)))).toBe(false);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const hint = page.getByRole("region", { name: "Live Caption", exact: true }).locator("kbd");
  await expect(hint).toHaveText(primary === "Meta" ? "\u2318\u2325L" : "Control+Alt+L");
  await page.evaluate(async () => {
    const path = "/src/shared/settings/userSettings.ts";
    const { updateUserSettings } = await import(path);
    await updateUserSettings({ keybindings: { "caption.start": "Mod+Shift+J" } });
  });
  await expect(hint).toHaveText(primary === "Meta" ? "\u21e7\u2318J" : "Shift+Control+J");
  await page.keyboard.press(`${primary}+Shift+j`);
  await expect.poll(async () => (await starts()).length).toBe(3);
  await page.evaluate(async () => {
    const path = "/src/shared/settings/userSettings.ts";
    const { updateUserSettings } = await import(path);
    await updateUserSettings({ keybindings: { "caption.start": null } });
  });
  await expect(hint).toHaveCount(0);
  await page.keyboard.press(`${primary}+Alt+l`);
  await page.keyboard.press(`${primary}+Shift+j`);
  expect((await starts()).length).toBe(3);
});
