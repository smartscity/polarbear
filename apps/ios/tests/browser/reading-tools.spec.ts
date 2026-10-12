import { expect, test, type Page } from "@playwright/test";

async function nativeReader(page: Page) {
  await page.addInitScript(() => {
    const entry = { collection: "reading", path: "English.md", importedAt: 1 };
    let captures: Record<string, unknown>[] = [];
    let finishSpeech: (() => void) | undefined;
    const calls: string[] = [];
    Object.assign(window, {
      isTauri: true, __readingCalls: calls,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
      __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          calls.push(command);
          switch (command) {
            case "plugin:event|listen": return 1;
            case "plugin:event|unlisten": return;
            case "plugin:reader|pending_open_documents": return [];
            case "plugin:reader|listDocuments": return { entries: [entry] };
            case "plugin:reader|readDocument": return { content: "# Reading\n\nA resilient team learns together.\n\n" + "Another paragraph for reading.\n\n".repeat(50) };
            case "plugin:reader|translateText":
              if (args.text === "missing") throw new Error("languagePackMissing");
              if (args.text === "slow") { await new Promise((resolve) => setTimeout(resolve, 1000)); return { text: "OLD RESULT" }; }
              return { text: "有韧性的；适应力强的" };
            case "plugin:reader|cancelTranslation": return;
            case "plugin:reader|speakText": return new Promise<void>((resolve) => { finishSpeech = resolve; });
            case "plugin:reader|stopSpeech": finishSpeech?.(); finishSpeech = undefined; return;
            case "plugin:reader|showDictionary": return;
            case "plugin:reader|saveCapture": {
              const capture = args.capture as Record<string, unknown>;
              if (!captures.some((item) => item.requestId === capture.requestId)) captures.push(capture);
              return capture;
            }
            case "plugin:reader|listCaptures": return [...captures];
            case "plugin:reader|removeCapture": captures = captures.filter((item) => item.requestId !== args.requestId); return;
            case "plugin:reader|shareCaptures": return { shared: true };
            default: throw new Error(command);
          }
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "English.md English.md" }).click();
}

async function selectWord(page: Page) {
  await page.locator(".reader-prose p").first().evaluate((paragraph) => {
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 2); range.setEnd(paragraph.firstChild!, 11);
    const selection = document.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

test("translates a selection in place, stops speech and persists an honest pending capture", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await nativeReader(page);
  await selectWord(page);
  const card = page.getByRole("complementary", { name: "Reading tools" });
  await expect(card).toContainText("resilient");
  await expect(card).toContainText("有韧性的");
  await card.getByRole("button", { name: "Read aloud" }).click();
  await expect(card.getByRole("button", { name: "Stop reading" })).toBeVisible();
  await card.getByRole("button", { name: "Stop reading" }).click();
  await expect(card.getByRole("button", { name: "Read aloud" })).toBeVisible();
  await card.getByRole("button", { name: "Save word" }).click();
  await expect(card.getByRole("button", { name: "Saved · pending import" })).toBeDisabled();
  expect(await page.locator(".reading-scroll").evaluate((el) => el.scrollTop)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/reading-word-light.png" });
  await card.getByRole("button", { name: "Expand reading tools" }).click();
  await page.getByRole("button", { name: "Words waiting for Vocab", exact: true }).click();
  await expect(page.locator(".reading-pending li")).toHaveCount(1);
  await page.getByRole("button", { name: "Export for Vocab" }).click();
  await expect(page.getByRole("status")).toContainText("Import the file in Vocab");
  await expect(page.locator(".reading-pending li")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("supports manual lookup, discards stale translations and localizes the reading panel", async ({ page }) => {
  await nativeReader(page);
  await page.getByRole("button", { name: "Reading tools", exact: true }).click();
  const input = page.getByRole("textbox", { name: "English word or sentence" });
  await input.fill("slow"); await page.getByRole("button", { name: "Translate", exact: true }).click();
  await input.fill("resilient"); await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.locator(".reading-translation")).toContainText("有韧性的");
  await page.waitForTimeout(1100);
  await expect(page.locator(".reading-translation")).not.toContainText("OLD RESULT");
  await input.fill("missing"); await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("No text was sent online");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByLabel("Appearance").selectOption("dark");
  await page.getByLabel("Language").selectOption("zh-CN");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await selectWord(page);
  await expect(page.getByRole("button", { name: "收藏生词" })).toBeVisible();
  await page.screenshot({ path: "test-results/reading-word-dark.png" });
});

test("requires a word for sentence captures and offers source opt-out", async ({ page }) => {
  await nativeReader(page);
  await page.getByRole("button", { name: "Reading tools", exact: true }).click();
  await page.getByRole("textbox", { name: "English word or sentence" }).fill("A resilient team learns together.");
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.getByLabel("Word or phrase to save")).toHaveValue("");
  await page.getByLabel("Word or phrase to save").fill("resilient");
  await page.getByLabel("Include the sentence and article title").uncheck();
  await page.getByRole("button", { name: "Save word" }).click();
  await expect(page.getByRole("button", { name: "Saved · pending import" })).toBeDisabled();
  await page.getByRole("button", { name: "Words waiting for Vocab", exact: true }).click();
  await expect(page.locator(".reading-pending li")).toContainText("resilient");
  await expect(page.locator(".reading-pending small")).toHaveText("");
});
