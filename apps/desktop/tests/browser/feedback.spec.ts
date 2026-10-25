import { expect, test } from "@playwright/test";
import { nativeFixture } from "./fixtures/native";

const issuesUrl = "https://github.com/smartscity/polarbear/issues";
const englishLabel = "Feedback / Report an issue on GitHub";
const chineseLabel = "反馈 / 在 GitHub 报告问题";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Match the event cleanup hook injected by the native Tauri runtime.
    Object.assign(window, { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} } });
  });
});

test("opens feedback on explicit keyboard activation from both surfaces without losing a draft", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => Object.assign(window, { isTauri: true }));
  await page.goto("/");
  const opens = () => page.evaluate(() => (window as any).__navigationCalls.filter((call: any) => call.command === "open_external_url"));
  const editor = page.locator(".editor-workspace .cm-content").first();
  await editor.click();
  await page.keyboard.type("Keep this feedback draft.");
  expect(await opens()).toEqual([]);
  const original = page.url();
  const feedback = page.getByRole("button", { name: englishLabel, exact: true });
  await feedback.focus();
  await page.keyboard.press("Enter");
  await expect.poll(opens).toEqual([{ command: "open_external_url", args: { url: issuesUrl } }]);
  await expect(editor).toContainText("Keep this feedback draft.");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  await page.locator(".activity-rail button").nth(1).click();
  await expect(page.locator(".activity-rail button").nth(1)).toHaveAttribute("aria-pressed", "true");
  await feedback.click();
  await expect.poll(async () => (await opens()).length).toBe(2);
  await page.locator(".activity-rail button").first().click();
  await expect(editor).toContainText("Keep this feedback draft.");
  await expect(page.locator(".window-tab-dirty")).toHaveCount(1);
  expect(page.url()).toBe(original);
});

test("localizes feedback immediately and reports native launch failures without browser fallback", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    const runtime = (window as any).__TAURI_INTERNALS__, invoke = runtime.invoke;
    Object.assign(window, { isTauri: true, __feedbackErrors: [], __browserOpens: 0 });
    window.open = () => { (window as any).__browserOpens++; return null; };
    runtime.invoke = (command: string, args: any) => {
      if (command === "open_external_url") return Promise.reject("private launcher diagnostic");
      if (command === "plugin:dialog|message") {
        (window as any).__feedbackErrors.push(args);
        return Promise.resolve();
      }
      return invoke(command, args);
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: englishLabel, exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).__feedbackErrors))).toContain("The link could not be opened");
  await page.locator(".status-language-select").selectOption("zh-CN");
  const feedback = page.getByRole("button", { name: chineseLabel, exact: true });
  await expect(feedback).toHaveAttribute("title", chineseLabel);
  await feedback.click();
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).__feedbackErrors))).toContain("无法打开链接");
  expect(await page.evaluate(() => (window as any).__browserOpens)).toBe(0);
  expect(errors).toEqual([]);
});

test("uses an isolated browser target and remains visible in narrow light and dark layouts", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    Object.assign(window, { isTauri: false, __feedbackOpens: [] });
    window.open = (...args) => { (window as any).__feedbackOpens.push(args); return null; };
  });
  await page.setViewportSize({ width: 500, height: 600 });
  await page.goto("/");
  const original = page.url();
  const feedback = page.getByRole("button", { name: englishLabel, exact: true });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(async (theme) => {
      const path = "/src/features/theme/themeTokens.ts";
      (await import(path)).applyThemeTokens(theme);
    }, theme);
    await expect(feedback).toBeInViewport();
    const box = (await feedback.boundingBox())!;
    expect(box.y).toBeGreaterThan(500);
    expect(box.y + box.height).toBeLessThanOrEqual(600);
    await feedback.click();
    await page.screenshot({ path: `test-results/feedback-${theme}.png` });
  }
  expect(await page.evaluate(() => (window as any).__feedbackOpens)).toEqual([
    [issuesUrl, "_blank", "noopener,noreferrer"],
    [issuesUrl, "_blank", "noopener,noreferrer"],
  ]);
  expect(page.url()).toBe(original);
});
