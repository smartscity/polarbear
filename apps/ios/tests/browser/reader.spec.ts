import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const article = `# Reading on iPhone

An offline **Markdown** document with 中文 and [an internal link](#details).

| Name | Notes |
| --- | --- |
| Table | First<br>Second |

- [x] Available offline
- [ ] Next chapter

![remote](https://example.invalid/tracker.png)

\`\`\`mermaid
flowchart TD
  A[Local documents] --> B[Read anywhere]
\`\`\`

## Details

${Array.from({ length: 70 }, (_, i) => `Paragraph ${i}: A quiet place to read. 中文段落与 English text.`).join("\n\n")}

## End

Finished.
`;

test("imports, reads, restores progress, switches language and never requests remote images", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { if (r.url().includes("example.invalid")) external.push(r.url()); });
  await page.goto("/");
  await expect(page.getByText("Your reading, wherever you are")).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "Reading.md", mimeType: "text/markdown", buffer: Buffer.from(article) });
  await page.getByRole("button", { name: "Reading.md Reading.md" }).click();
  await expect(page.getByRole("heading", { name: "Reading on iPhone" })).toBeVisible();
  await expect(page.getByText("External image blocked. No network request was made.")).toBeVisible();
  await expect(page.locator(".reader-diagram > img")).toBeVisible({ timeout: 30000 });
  await expect.poll(() => page.locator(".reader-diagram > img").evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/iphone-reader-light.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.waitForTimeout(350);
  const before = await page.locator(".reading-scroll").evaluate((el) => el.scrollTop);
  const endTop = await page.getByRole("heading", { name: "End", exact: true }).evaluate((el) => el.getBoundingClientRect().top);
  expect(before).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Reading.md Reading.md" }).click();
  await expect.poll(async () => Math.abs(await page.getByRole("heading", { name: "End", exact: true }).evaluate((el) => el.getBoundingClientRect().top) - endTop)).toBeLessThan(2);
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByLabel("Appearance").selectOption("dark");
  await page.getByLabel("Language").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "阅读设置" })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-reader-theme", "dark");
  await page.screenshot({ path: "test-results/iphone-reader-dark.png" });
  expect(external).toEqual([]);
});

test("handles import failure without losing an existing collection", async ({ page }) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({ name: "Safe.md", mimeType: "text/plain", buffer: Buffer.from("# Safe") });
  await expect(page.getByRole("button", { name: "Safe.md Safe.md" })).toBeVisible();
  await input.setInputFiles({ name: "Invalid.md", mimeType: "text/plain", buffer: Buffer.from([255, 254]) });
  await expect(page.getByRole("alert")).toContainText("not valid UTF-8");
  await page.reload();
  await expect(page.getByRole("button", { name: "Safe.md Safe.md" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invalid.md Invalid.md" })).toHaveCount(0);
});

test("keeps wide tables inside the reading area at narrow widths and large text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "Wide.md", mimeType: "text/plain", buffer: Buffer.from("# Wide\n\n| A | B | C | D | E |\n|---|---|---|---|---|\n| Long content | 中文内容 | Three | Four | Five |") });
  await page.getByRole("button", { name: "Wide.md Wide.md" }).click();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("slider", { name: "Font size" }).fill("28");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator("table").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/iphone-reader-narrow.png" });
});

test("imports local images and linked documents as an offline collection", async ({ page }) => {
  const folder = await mkdtemp(join(tmpdir(), "reader-fixture-"));
  try {
    await mkdir(join(folder, "images"));
    await writeFile(join(folder, "文章.md"), "# Local image\n\n![Polarbear](images/logo.png)\n\n[Next chapter](next.md#next)");
    await writeFile(join(folder, "next.md"), "# Next\n\nOffline chapter.");
    await copyFile(resolve("../desktop/src-tauri/icons/128x128.png"), join(folder, "images/logo.png"));
    await page.goto("/");
    await page.locator('input[type="file"][webkitdirectory]').setInputFiles(folder);
    await expect(page.locator(".book-list li")).toHaveCount(2);
    await rm(folder, { recursive: true });
    await page.getByRole("button", { name: "文章.md 文章.md" }).click();
    await expect.poll(() => page.locator(".image-button img").evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(128);
    await page.getByRole("button", { name: "View full screen" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("slider", { name: "Zoom" }).fill("200");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("link", { name: "Next chapter" }).click();
    await expect(page.getByRole("heading", { name: "Next", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: "Remove local collection" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove local collection" }).click();
    await expect(page.locator(".book-list li")).toHaveCount(0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("keeps PlantUML source readable and does not render remotely", async ({ page }) => {
  const remote: string[] = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith("http://127.0.0.1:1430")) remote.push(request.url()); });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "Diagram.md", mimeType: "text/plain", buffer: Buffer.from("# Diagram\n\n```plantuml\n@startuml\nAlice -> Bob\n@enduml\n```") });
  await page.getByRole("button", { name: "Diagram.md Diagram.md" }).click();
  await expect(page.getByText(/PlantUML source only/)).toBeVisible();
  await page.locator("summary").click();
  await expect(page.locator("pre")).toContainText("Alice -> Bob");
  expect(remote).toEqual([]);
});

test("flushes a mid-document position when leaving before the debounce completes", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "Long.md", mimeType: "text/plain", buffer: Buffer.from("# Start\n\n" + Array.from({ length: 60 }, (_, i) => `Paragraph ${i} with readable content.`).join("\n\n")) });
  await page.getByRole("button", { name: "Long.md Long.md" }).click();
  await page.locator(".reading-scroll").evaluate((el) => { el.scrollTop = 900; });
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Long.md Long.md" }).click();
  await expect.poll(async () => Math.abs(await page.locator(".reading-scroll").evaluate((el) => el.scrollTop) - 900)).toBeLessThan(2);
});
