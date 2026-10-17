import { test, expect, type Page } from "@playwright/test";

async function initialize(page: Page, history = false) {
  await page.addInitScript(() => {
    let state = "capturing";
    let viewRevision = 0;
    let historyRequested = false;
    const rows = [
      { id: 1, sessionId: "fixture", startMs: 1000, endMs: 2200, english: "We should review this tomorrow.", chinese: "我们应该明天审查此事。", translationStatus: "ready" },
      { id: 2, sessionId: "fixture", startMs: 2300, endMs: 4000, english: "The deadline is Friday.", chinese: null, translationStatus: "pending" },
    ];
    const calls: unknown[] = [];
    Object.assign(window, { __openCaptionHistory: () => { historyRequested = true; viewRevision += 1; }, __captionCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args: { request: { action: string } }) => {
        if (command !== "caption_request") throw new Error("Unexpected IPC");
        const request = args.request;
        calls.push(request);
        switch (request.action) {
          case "status": return { sessionId: "fixture", state, source: "system", partial: "An unfinished sentence", elapsedMs: 5000, error: null, viewRevision, historyRequested };
          case "tail": case "segments": case "snapshot": return rows;
          case "list": return [{ id: "fixture", title: "Fixture meeting", place: "Room A", startedAt: 1700000000000, endedAt: null, source: "system", status: state, count: 2 }];
          case "pause": state = "paused"; return;
          case "resume": state = "capturing"; return;
          case "stop": state = "stopped"; return;
          default: return;
        }
      },
    } });
  });
  await page.goto(`/caption.html?surface=caption&history=${history}`);
  await expect(page.getByText("We should review this tomorrow.", { exact: true })).toBeVisible({ timeout: 15000 });
}

test("copies finalized bilingual content without partial text and pauses independently", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await initialize(page);
  await page.getByRole("button", { name: "Copy transcript", exact: true }).click();
  await expect(page.getByText("Copied. Translations pending: 1")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("We should review this tomorrow.\n我们应该明天审查此事。\n\nThe deadline is Friday.");
  await page.getByRole("button", { name: "Pause / resume captions" }).click();
  await expect(page.locator(".caption-state")).toHaveText("Paused");
  await page.getByRole("button", { name: "Pause / resume captions" }).click();
  await expect(page.locator(".caption-state")).toHaveText("Listening");
});

test("opens history without starting audio and exports through the native boundary", async ({ page }) => {
  await initialize(page);
  await page.getByRole("button", { name: "Caption history", exact: true }).click();
  await page.getByRole("button", { name: /Fixture meeting/ }).click();
  await expect(page.getByRole("textbox", { name: "Place (optional)" })).toHaveValue("Room A");
  await page.getByRole("button", { name: "Caption options" }).click();
  await page.getByRole("button", { name: "Export transcript", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __captionCalls: { action: string }[] }).__captionCalls.some((call) => call.action === "export"))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __captionCalls: { action: string }[] }).__captionCalls.some((call) => call.action === "start"))).toBe(false);
});

test("keeps controls visible at narrow width and supports dark captions", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 300 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await initialize(page);
  await expect(page.getByRole("button", { name: "Copy transcript", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".caption-transcript").evaluate((element) => element.clientHeight)).toBeGreaterThan(30);
  await page.screenshot({ path: "test-results/caption-dark-narrow.png" });
});

test("reveals history when the native command targets an already open panel", async ({ page }) => {
  await initialize(page);
  await page.evaluate(() => (window as unknown as { __openCaptionHistory: () => void }).__openCaptionHistory());
  await expect(page.getByRole("button", { name: /Fixture meeting/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __captionCalls: { action: string }[] }).__captionCalls.some((call) => call.action === "start"))).toBe(false);
});

test("updates caption language and system theme without reopening the window", async ({ page }) => {
  await initialize(page);
  await page.evaluate(async () => {
    const modulePath = "/src/shared/settings/userSettings.ts";
    const { updateUserSettings } = await import(modulePath);
    updateUserSettings({ language: "zh-CN" });
  });
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-caption-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-caption-theme", "light");
});

test("translates a leased caption with the actual bundled offline engine", async ({ page }) => {
  test.setTimeout(120000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.protocol === "blob:" || url.protocol === "data:") return route.continue();
    return route.abort();
  });
  await page.addInitScript(() => {
    let claimed = false;
    Object.assign(window, { __translation: null, __TAURI_INTERNALS__: {
      invoke: async (_: string, args: { request: { action: string; chinese?: string } }) => {
        if (args.request.action === "claim" && !claimed) { claimed = true; return { id: 1, lease: "fixture", english: "Hello, how are you?" }; }
        if (args.request.action === "complete") Object.assign(window, { __translation: args.request.chinese });
        return null;
      },
    } });
  });
  await page.goto("/caption.html?surface=caption-translator");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __translation: string | null }).__translation), { timeout: 100000 }).toMatch(/[\u4e00-\u9fff]/);
});
