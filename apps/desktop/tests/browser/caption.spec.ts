import { test, expect, type Page } from "@playwright/test";

async function initialize(page: Page, history = false) {
  await page.addInitScript(() => {
    let state = "capturing";
    let source = "system";
    let partial = "An unfinished sentence";
    let viewRevision = 0;
    let historyRequested = false;
    let recordAudio = false;
    let failPoll = false;
    const rows = [
      { id: 1, sessionId: "fixture", startMs: 1000, endMs: 2200, english: "We should review this tomorrow.", chinese: "我们应该明天审查此事。", translationStatus: "ready" },
      { id: 2, sessionId: "fixture", startMs: 2300, endMs: 4000, english: "The deadline is Friday.", chinese: null, translationStatus: "pending" },
    ];
    const calls: unknown[] = [];
    Object.assign(window, {
      __failCaptionPoll: (value: boolean) => { failPoll = value; },
      __longCaptionHistory: () => {
        rows.length = 0;
        for (let id = 1; id <= 7200; id++) rows.push({ id, sessionId: "fixture", startMs: (id - 1) * 1000, endMs: id * 1000, english: `Final sentence ${id}.`, chinese: null, translationStatus: "pending" });
      },
    });
    Object.assign(window, { __finalizeCaption: () => { rows.push({ id: 3, sessionId: "fixture", startMs: 44000, endMs: 46000, english: partial, chinese: null, translationStatus: "pending" }); partial = "We need to review"; }, __emptyCaption: () => { rows.length = 0; partial = ""; }, __openCaptionHistory: () => { historyRequested = true; viewRevision += 1; }, __captionCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args: { request: { action: string; source?: string; recordAudio?: boolean } }) => {
        if (command !== "caption_request") throw new Error("Unexpected IPC");
        const request = args.request;
        calls.push(request);
        switch (request.action) {
          case "status": return { sessionId: "fixture", state, source, partial, elapsedMs: 5000, audioLevel: 0, error: null, viewRevision, historyRequested, recordAudio };
          case "live": {
            if (failPoll) throw new Error("Fixture polling failure");
            return { status: { sessionId: "fixture", state, source, partial, elapsedMs: 5000, audioLevel: 0, error: null, viewRevision, historyRequested, recordAudio }, segments: rows.slice(-200) };
          }
          case "tail": case "segments": case "snapshot": return rows;
          case "list": return [{ id: "fixture", title: "Fixture meeting", place: "Room A", startedAt: 1700000000000, endedAt: null, source: "system", status: state, count: 2 }];
          case "pause": state = "paused"; return;
          case "resume": state = "capturing"; return;
          case "stop": state = "stopped"; return;
          case "start": source = request.source ?? source; recordAudio = request.recordAudio === true; state = "capturing"; return;
          default: return;
        }
      },
    } });
  });
  await page.goto(`/caption.html?surface=caption&history=${history}`);
  await expect(page.getByText("We should review this tomorrow.", { exact: true })).toBeVisible({ timeout: 15000 });
}

async function enableTranslation(page: Page) {
  await page.evaluate(async () => {
    const modulePath = "/src/shared/settings/userSettings.ts";
    const { readUserSettings, updateUserSettings } = await import(modulePath);
    updateUserSettings({ caption: { ...readUserSettings().caption, showChinese: true, language: "bilingual" } });
  });
}

test("copies finalized bilingual content without partial text and pauses independently", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await initialize(page);
  await enableTranslation(page);
  await page.getByRole("button", { name: "Copy transcript", exact: true }).click();
  await expect(page.getByText("Copied. Translations pending: 1")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("We should review this tomorrow.\n我们应该明天审查此事。\n\nThe deadline is Friday.");
  await page.getByRole("button", { name: "Pause / resume captions" }).click();
  await expect(page.locator(".caption-state")).toHaveText("Paused");
  await page.getByRole("button", { name: "Pause / resume captions" }).click();
  await expect(page.locator(".caption-state")).toHaveText("Listening");
});

test("flows partial and finalized speech continuously while retaining timestamps only in history", async ({ page }) => {
  await initialize(page);
  await enableTranslation(page);
  const english = page.locator(".caption-live-english");
  await expect(english).toHaveText("We should review this tomorrow. The deadline is Friday. An unfinished sentence");
  await expect(page.locator(".caption-transcript time")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __finalizeCaption: () => void }).__finalizeCaption());
  await expect(english).toHaveText("We should review this tomorrow. The deadline is Friday. An unfinished sentence We need to review");
  await expect(page.getByText("Translating locally…", { exact: true })).toHaveCount(1);
  await page.screenshot({ path: "test-results/caption-continuous.png" });
  await page.getByRole("button", { name: "Caption history", exact: true }).click();
  await page.getByRole("button", { name: /Fixture meeting/ }).click();
  await expect(page.locator(".caption-transcript time")).toHaveCount(3);
  await expect(page.locator(".caption-live-english")).toHaveCount(0);
});

test("makes the active source explicit and switches to microphone without losing the stop boundary", async ({ page }) => {
  await initialize(page);
  await page.evaluate(() => (window as unknown as { __emptyCaption: () => void }).__emptyCaption());
  const source = page.getByRole("combobox", { name: "Audio source", exact: true });
  await expect(source).toHaveValue("system");
  await expect(page.getByText(/Listening to computer playback, not your microphone/)).toBeVisible();
  await source.selectOption("microphone");
  await expect(source).toHaveValue("microphone");
  await expect(page.getByText(/Listening through the microphone/)).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { __captionCalls: { action: string; source?: string }[] }).__captionCalls.filter(call => call.action === "stop" || call.action === "start"));
  expect(calls.map(call => call.action)).toEqual(["stop", "start"]);
  expect(calls[1].source).toBe("microphone");
  await page.setViewportSize({ width: 360, height: 300 });
  await page.screenshot({ path: "test-results/caption-source-narrow.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
  await enableTranslation(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __translation: string | null }).__translation), { timeout: 100000 }).toMatch(/[\u4e00-\u9fff]/);
});

test("defaults to English and persists translation opt-in across reloads", async ({ page }) => {
  await initialize(page);
  await expect(page.locator(".caption-chinese")).toHaveCount(0);
  await page.getByRole("button", { name: "Caption options" }).click();
  const toggle = page.getByRole("checkbox", { name: "Translate into Chinese (offline)" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.locator(".caption-chinese")).toBeVisible();
  await page.reload();
  await expect(page.locator(".caption-chinese")).toBeVisible();
  await page.getByRole("button", { name: "Caption options" }).click();
  await toggle.uncheck();
  await expect(page.locator(".caption-chinese")).toHaveCount(0);
});

for (const delayedMount of [false, true]) test(`does not claim translation work while disabled and stops polling on opt-out (delayed mount: ${delayedMount})`, async ({ page }) => {
  let releaseMount = () => {};
  const mountAllowed = new Promise<void>(resolve => { releaseMount = resolve; });
  if (delayedMount) await page.route("**/src/features/caption/CaptionTranslator.tsx", async route => {
    await mountAllowed;
    await route.continue();
  });
  try {
  await page.addInitScript(() => Object.assign(window, {
    __claims: 0,
    __TAURI_INTERNALS__: { invoke: async (_: string, args: { request: { action: string } }) => {
      if (args.request.action === "claim") (window as unknown as { __claims: number }).__claims++;
      return null;
    } },
  }));
  await page.clock.install();
  await page.goto("/caption.html?surface=caption-translator", { waitUntil: "domcontentloaded" });
  await page.clock.runFor(3000);
  const claims = () => page.evaluate(() => (window as unknown as { __claims: number }).__claims);
  expect(await claims()).toBe(0);
  await enableTranslation(page);
  await page.clock.runFor(1000);
  if (delayedMount) expect(await claims()).toBe(0);
  releaseMount();
  await expect.poll(async () => {
    await page.clock.runFor(250);
    return claims();
  }).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const modulePath = "/src/shared/settings/userSettings.ts";
    const { readUserSettings, updateUserSettings } = await import(modulePath);
    updateUserSettings({ caption: { ...readUserSettings().caption, showChinese: false } });
  });
  await expect.poll(async () => {
    const before = await claims();
    await page.clock.runFor(1500);
    return (await claims()) - before;
  }).toBe(0);
  const stopped = await claims();
  await page.clock.runFor(3000);
  expect(await claims()).toBe(stopped);
  } finally { releaseMount(); }
});

test("records audio only for an explicitly armed session", async ({ page }) => {
  await initialize(page);
  await page.getByRole("button", { name: "Stop capture", exact: true }).click();
  await expect(page.locator(".caption-state")).toHaveText("Stopped");
  await page.getByRole("button", { name: "Caption options" }).click();
  const recording = page.getByRole("checkbox", { name: "Save diagnostic audio for the next session" });
  await expect(recording).not.toBeChecked();
  await recording.check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Start capture", exact: true }).click();
  await expect(page.getByText("Recording audio locally", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop capture", exact: true }).click();
  await expect(page.locator(".caption-state")).toHaveText("Stopped");
  await page.getByRole("button", { name: "Caption options" }).click();
  await expect(recording).not.toBeChecked();
  await page.getByRole("button", { name: "Open recordings folder" }).click();
  expect(await page.evaluate(() => (window as unknown as { __captionCalls: { action: string }[] }).__captionCalls.some(call => call.action === "recordingsFolder"))).toBe(true);
});

test("recovers its bounded projection after simulated observer suspension and polling failure", async ({ page }) => {
  await page.clock.install();
  await initialize(page);
  await page.evaluate(() => {
    const fixture = window as unknown as { __longCaptionHistory: () => void; __failCaptionPoll: (value: boolean) => void };
    fixture.__longCaptionHistory(); fixture.__failCaptionPoll(true);
  });
  await page.clock.runFor(1000);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.evaluate(() => (window as unknown as { __failCaptionPoll: (value: boolean) => void }).__failCaptionPoll(false));
  // Skipped browser timers, not a two-hour native microphone or WebView qualification.
  await page.clock.fastForward(2 * 60 * 60 * 1000);
  await expect(page.locator(".caption-live-english > span:not(.caption-partial)")).toHaveCount(200);
  await expect(page.getByText("Final sentence 7200.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".caption-state")).toHaveText("Listening");
  await page.locator(".caption-transcript").evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();
  await page.clock.runFor(3000);
  expect(await page.locator(".caption-transcript").evaluate(element => element.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 360, height: 500 });
  await page.screenshot({ path: "test-results/caption-long-history.png" });
});
