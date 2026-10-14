import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { flowchartFixtures, additionalDiagramFixtures, diagramDocument } from "./mermaidFixtures";

async function initialize(page: Page) {
  await page.addInitScript(() => {
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    Object.assign(window, { isTauri: true, __qualityCalls: calls, __TAURI_INTERNALS__: {
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        calls.push({ command, args });
        if (command === "vocab_request") {
          const operation = args.operation as { query: string };
          if (operation.query === "slow") { await new Promise((resolve) => setTimeout(resolve, 900)); return [{ senseUid: "old", lemma: "slow", ipa: "", partOfSpeech: "adjective", zhGloss: "OLD", inMyVocabulary: false }]; }
          return [{ senseUid: "attractive", lemma: operation.query, ipa: "/əˈtræktɪv/", partOfSpeech: "adjective", zhGloss: "有吸引力的", inMyVocabulary: false }];
        }
        if (["speak_reading", "stop_reading_speech", "write_document_copy", "write_clipboard_image"].includes(command)) return;
        if (["begin_document_copy", "begin_image_copy"].includes(command)) return 42;
        return undefined;
      },
    } });
  });
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(() => "__quality" in window);
}

async function setSource(page: Page, text: string, mode: "live" | "source" | "preview" = "live") {
  await page.evaluate(({ text, mode }) => {
    const harness = (window as unknown as { __quality: { setMarkdown: (text: string) => void; setMode: (mode: string) => void } }).__quality;
    harness.setMarkdown(text); harness.setMode(mode);
  }, { text, mode });
  if (mode !== "preview") await expect.poll(() => page.evaluate(() => (window as unknown as { __quality: { source: () => string } }).__quality.source())).toBe(text);
}

async function paste(page: Page, text: string) {
  await page.locator(".cm-content").evaluate((element, text) => {
    const data = new DataTransfer(); data.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

async function selectText(page: Page, selector: string, text: string, hold = false) {
  const rect = await page.locator(selector).evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.includes(text)) node = walker.nextNode();
    if (!node) throw new Error("Selection text missing");
    const start = node.textContent!.indexOf(text);
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
    const box = range.getBoundingClientRect();
    return { x: box.left, y: box.top + box.height / 2, end: box.right };
  }, text);
  await page.mouse.move(rect.x, rect.y); await page.mouse.down();
  await page.mouse.move(rect.end, rect.y, { steps: 12 });
  if (hold) {
    await page.waitForTimeout(350);
    await expect(page.locator(".vocab-popover")).toHaveCount(0);
  }
  await page.mouse.up();
}

test("validates the three flowchart families and pastes raw diagrams as atomic Mermaid blocks", async ({ page }) => {
  await initialize(page);
  for (const fixture of flowchartFixtures) {
    expect(await page.evaluate((source) => (window as unknown as { __quality: { validate: (source: string) => Promise<boolean> } }).__quality.validate(source), fixture.source), fixture.name).toBe(true);
    await setSource(page, "Before\n\n");
    await page.evaluate(() => (window as unknown as { __quality: { select: (from: number, to: number) => void } }).__quality.select(8, 8));
    await paste(page, fixture.source);
    await expect(page.locator(".cm-typora-diagram-content svg")).toBeVisible();
    const pasted = await page.evaluate(() => (window as unknown as { __quality: { source: () => string } }).__quality.source());
    expect(pasted).toContain("```mermaid"); expect(pasted).toContain(fixture.source);
    await page.evaluate(() => (window as unknown as { __quality: { undo: () => void } }).__quality.undo());
    await expect.poll(() => page.evaluate(() => (window as unknown as { __quality: { source: () => string } }).__quality.source())).toBe("Before\n\n");
    await page.evaluate(() => (window as unknown as { __quality: { redo: () => void } }).__quality.redo());
    await expect(page.locator(".cm-typora-diagram-content svg")).toBeVisible();
  }
  await page.screenshot({ path: "test-results/mermaid-live.png" });
  await page.reload();
  await expect(page.locator(".cm-typora-diagram-content svg")).toBeVisible();
});

test("isolates invalid source, supports fenced pastes and avoids converting code inside fences", async ({ page }) => {
  await initialize(page);
  await setSource(page, "");
  const invalid = "flowchart TD\nA[unclosed";
  await paste(page, invalid);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __quality: { source: () => string } }).__quality.source())).toBe(invalid);
  await expect(page.getByRole("status")).toContainText("could not be parsed");
  await setSource(page, "```mermaid\n" + invalid + "\n```\n\n");
  await expect(page.locator(".cm-typora-diagram-error")).toBeVisible();
  await setSource(page, "```js\nconst first = 1;\n```\n\n```text\n\n```", "source");
  await page.evaluate(() => {
    const harness = (window as unknown as { __quality: { select: (from: number, to: number) => void; source: () => string } }).__quality;
    const position = harness.source().indexOf("```text") + "```text\n".length;
    harness.select(position, position);
  });
  await paste(page, flowchartFixtures[0].source);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __quality: { source: () => string } }).__quality.source())).toContain(flowchartFixtures[0].source);
  expect(await page.evaluate(() => (window as unknown as { __quality: { source: () => string } }).__quality.source())).not.toContain("```mermaid");
  await setSource(page, "", "live");
  await paste(page, "```mermaid\n" + flowchartFixtures[1].source + "\n```\n\n");
  await expect(page.locator(".cm-typora-diagram-content svg")).toBeVisible();
});

test("serializes consecutive raw pastes and preserves edited and reopened diagrams", async ({ page }) => {
  await initialize(page); await setSource(page, "");
  for (const fixture of flowchartFixtures) await paste(page, fixture.source);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __quality: { source: () => string } }).__quality.source().match(/```mermaid/g)?.length ?? 0)).toBe(3);
  await expect(page.locator(".cm-typora-diagram-content svg")).toHaveCount(3);
  const updated = diagramDocument.replace("EventId = id", "EventId = updated");
  await setSource(page, updated);
  await expect(page.locator(".cm-typora-diagram-content").first()).toContainText("updated");
  await page.reload(); await expect(page.locator(".cm-typora-diagram-content").first()).toContainText("updated");
});

test("copies multiple actual PNGs in order and exports a native receiver fixture", async ({ page }) => {
  await initialize(page);
  const debug = await page.evaluate((source) => (window as unknown as { __quality: { png: (source: string) => Promise<{ error?: string; svg: string }> } }).__quality.png(source), flowchartFixtures[0].source);
  if (debug.error) { await writeFile("test-results/clipboard-png-error.svg", debug.svg); throw new Error(debug.error); }
  const payload = await page.evaluate(() => (window as unknown as { __quality: { clipboard: () => Promise<{ html: string; plainText: string; runs: { png?: string }[] }> } }).__quality.clipboard());
  expect(payload.runs.filter((run) => run.png)).toHaveLength(3);
  expect(payload.html).toContain("<table>"); expect(payload.html).toContain("Introduction."); expect(payload.html).toContain("After");
  expect(payload.html).not.toContain("language-mermaid"); expect(payload.plainText).not.toMatch(/flowchart (TD|TB|LR)/);
  for (const run of payload.runs.filter((run) => run.png)) expect(Buffer.from(run.png!, "base64").subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const png = payload.runs.find((run) => run.png)!.png!;
  await writeFile("test-results/mermaid-copy.png", Buffer.from(png, "base64"));
  expect(await page.evaluate(async (png) => {
    const image = new Image(); image.src = "data:image/png;base64," + png; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 0 && pixels[i] < 160 && pixels[i + 1] < 160 && pixels[i + 2] < 160) dark++;
    return dark;
  }, png)).toBeGreaterThan(100);
  await writeFile("test-results/real-mermaid-clipboard.json", JSON.stringify(payload));
  await setSource(page, diagramDocument, "source");
  await page.evaluate(() => {
    const harness = (window as unknown as { __quality: { select: (from: number, to: number) => void; source: () => string } }).__quality;
    harness.select(0, harness.source().length);
  });
  await page.locator(".cm-content").evaluate((element) => element.dispatchEvent(new ClipboardEvent("copy", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })));
  await expect(page.getByRole("status")).toContainText("copied with diagram images");
  await setSource(page, "```mermaid\n" + flowchartFixtures[0].source + "\n```\n\n", "preview");
  await page.getByRole("button", { name: "Copy diagram as PNG", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __qualityCalls: { command: string }[] }).__qualityCalls.filter((call) => call.command === "write_clipboard_image").length)).toBe(1);
});

test("automatically translates settled selections without stealing focus and persists the opt-out", async ({ page }) => {
  await initialize(page);
  await setSource(page, "An attractive opportunity.\n\nThis is an English sentence.\n\n中文段落。", "preview");
  await selectText(page, ".markdown-preview-segment p:first-child", "attractive");
  const card = page.getByRole("dialog", { name: "Look up / Add to Vocab" });
  await expect(card).toContainText("有吸引力的"); await expect(card).toContainText("/əˈtræktɪv/");
  await expect(card.getByRole("button", { name: "US pronunciation" })).toBeVisible();
  await expect(card.getByRole("button", { name: "UK pronunciation" })).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest(".vocab-popover") === null)).toBe(true);
  await page.screenshot({ path: "test-results/automatic-word-translation.png" });
  await page.keyboard.press("Escape"); await expect(card).toHaveCount(0);
  await selectText(page, ".markdown-preview-segment p:nth-child(2)", "This is an English sentence.");
  await expect(card.locator(".reading-translation")).toContainText(/这是.*句子/, { timeout: 30_000 });
  await page.screenshot({ path: "test-results/bundled-offline-translation.png" });
  await card.getByRole("button", { name: "Copy translation" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("switch").uncheck();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await selectText(page, ".markdown-preview-segment p:first-child", "attractive");
  await expect(card).toHaveCount(0);
  await page.reload(); await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("switch")).not.toBeChecked();
});

test("rasterizes state, ER, sequence, gantt, pie, class and mindmap diagrams", async ({ page }) => {
  await initialize(page);
  for (const fixture of additionalDiagramFixtures) {
    const result = await page.evaluate((source) => (window as unknown as { __quality: { png: (source: string) => Promise<{ image?: string; error?: string }> } }).__quality.png(source), fixture.source);
    expect(result.error, fixture.name).toBeUndefined();
    expect(result.image, fixture.name).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(result.image!.split(",")[1], "base64").length, fixture.name).toBeGreaterThan(500);
  }
});

test("does not open while dragging or selecting code and discards stale dictionary responses", async ({ page }) => {
  await initialize(page);
  await setSource(page, "slow attractive\n\n```js\nconst attractive = true;\n```", "preview");
  await selectText(page, ".markdown-preview-segment p", "slow", true);
  await selectText(page, ".markdown-preview-segment p", "attractive");
  const card = page.getByRole("dialog", { name: "Look up / Add to Vocab" });
  await expect(card).toContainText("attractive"); await page.waitForTimeout(1100); await expect(card).not.toContainText("OLD");
  await page.keyboard.press("Escape");
  await selectText(page, ".markdown-preview-segment code", "attractive");
  await expect(card).toHaveCount(0);
});

test("supports source and live selections, cancels on blur and translates a real long paragraph", async ({ page }) => {
  await initialize(page);
  const card = page.getByRole("dialog", { name: "Look up / Add to Vocab" });
  for (const mode of ["source", "live"] as const) {
    await setSource(page, "An attractive opportunity.", mode);
    await selectText(page, ".cm-line", "attractive");
    await expect(card).toContainText("有吸引力的");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(card).toHaveCount(0);
  }
  const paragraph = "This is an English paragraph with enough detail for local reading. ".repeat(35);
  await setSource(page, paragraph, "preview");
  await expect(page.locator(".markdown-preview-segment p")).toHaveText(paragraph.trim());
  await page.locator(".markdown-preview-segment p").evaluate((element) => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const range = document.createRange(); range.selectNodeContents(element);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await expect(card.locator(".reading-translation")).toContainText(/英文|英语/, { timeout: 45_000 });
  expect((await card.locator(".reading-translation").innerText()).length).toBeGreaterThan(300);
});

test("favorites an offline unknown word in the header and delivers after the card closes", async ({ page }) => {
  await initialize(page);
  await page.evaluate(() => {
    const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = runtime.invoke;
    const captures: Record<string, unknown>[] = [];
    let delivered = false;
    Object.assign(window, { __favoriteCaptures: captures });
    runtime.invoke = async (command, args) => {
      if (command === "vocab_request") throw { code: "unavailable", message: "Vocab offline" };
      if (command === "enqueue_vocab_capture") {
        if (!captures.length) {
          captures.push(structuredClone(args.capture as Record<string, unknown>));
          setTimeout(() => { delivered = true; }, 700);
        }
        return { requestId: captures[0].requestId, state: delivered ? "saved" : "queued", error: null };
      }
      if (command === "vocab_capture_status") return { requestId: captures[0].requestId, state: delivered ? "saved" : "queued", error: null };
      return original(command, args);
    };
  });
  await setSource(page, "OEMS handles execution.", "preview");
  await selectText(page, ".markdown-preview-segment p", "OEMS");
  const card = page.getByRole("dialog", { name: "Look up / Add to Vocab" });
  await expect(card).toContainText("You can still favorite");
  const star = card.locator("header").getByRole("button", { name: "Favorite word" });
  await expect(star).toBeEnabled();
  await card.getByRole("checkbox").uncheck();
  await star.click();
  await expect(card).toContainText("Saved on this device");
  await expect(card.getByRole("button", { name: "Saved on this device · waiting to sync with Vocab", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as unknown as { __quality: { setTheme: (theme: string) => void } }).__quality.setTheme("light"));
  await page.screenshot({ path: "test-results/favorite-offline.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  await selectText(page, ".markdown-preview-segment p", "OEMS");
  await card.getByRole("checkbox").uncheck();
  await card.getByRole("button", { name: "Favorite word" }).click();
  await expect(card).toContainText("Saved for later in Vocab");
  const captures = await page.evaluate(() => (window as unknown as { __favoriteCaptures: Record<string, unknown>[] }).__favoriteCaptures);
  expect(captures).toHaveLength(1);
  expect(captures[0]).toMatchObject({ selectedText: "OEMS", senseUid: null, sentence: "", title: "", filePath: null, heading: "", line: null });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (window as unknown as { __quality: { setTheme: (theme: string) => void } }).__quality.setTheme("dark"));
  const box = await card.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/favorite-dark-narrow.png" });
});

test("reports missing bundled assets without a download step and retries after repair", async ({ page }) => {
  await page.route("**/models/en-zh/*.gz", (route) => route.fulfill({ status: 404, body: "Missing bundled asset" }));
  await initialize(page);
  await setSource(page, "This is an English sentence.", "preview");
  await selectText(page, ".markdown-preview-segment p", "This is an English sentence.");
  const card = page.getByRole("dialog", { name: "Look up / Add to Vocab" });
  await expect(card.getByRole("alert")).toContainText("bundled translation files are missing");
  await expect(card.getByRole("button", { name: /Download language/ })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "US pronunciation" })).toBeEnabled();
  await page.unroute("**/models/en-zh/*.gz");
  await card.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(card.locator(".reading-translation")).toContainText(/这是.*句子/, { timeout: 30_000 });
});

test("rejects corrupt bundled models without losing speech controls", async ({ page }) => {
  await page.route("**/models/en-zh/*.gz", (route) => route.fulfill({ status: 200, body: "corrupt model" }));
  await initialize(page);
  await setSource(page, "This is an English sentence.", "preview");
  await selectText(page, ".markdown-preview-segment p", "This is an English sentence.");
  const card = page.getByRole("dialog", { name: "Look up / Add to Vocab" });
  await expect(card.getByRole("alert")).toContainText("could not be verified");
  await expect(card.getByRole("button", { name: "US pronunciation" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
});

test("does not report a disk failure as a favorite and retries the immutable capture", async ({ page }) => {
  await initialize(page);
  await page.evaluate(() => {
    const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = runtime.invoke;
    const requests: unknown[] = [];
    Object.assign(window, { __favoriteAttempts: requests });
    runtime.invoke = async (command, args) => {
      if (command === "enqueue_vocab_capture") {
        requests.push(structuredClone(args.capture));
        if (requests.length === 1) throw { code: "storageFailed", message: "Disk full" };
        return { requestId: (args.capture as { requestId: string }).requestId, state: "saved", error: null };
      }
      return original(command, args);
    };
  });
  await setSource(page, "An attractive opportunity.", "preview");
  await selectText(page, ".markdown-preview-segment p", "attractive");
  const card = page.getByRole("dialog", { name: "Look up / Add to Vocab" });
  await expect(card).toContainText("有吸引力的");
  await card.getByRole("button", { name: "Favorite word" }).click();
  await expect(card.getByRole("alert")).toContainText("disk space");
  await expect(card.getByRole("button", { name: "Favorite word" })).toHaveAttribute("aria-pressed", "false");
  await card.getByRole("button", { name: "Favorite word" }).click();
  await expect(card.locator("header")).toContainText("Saved to Vocab");
  const requests = await page.evaluate(() => (window as unknown as { __favoriteAttempts: unknown[] }).__favoriteAttempts);
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
});
