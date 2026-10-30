import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const test = base.extend({
  context: async ({ context, browserName, playwright, baseURL, viewport, locale }, use) => {
    if (browserName !== "webkit") { await use(context); return; }
    // macOS Playwright's ephemeral WebKit store cannot persist Blob/File values.
    // A disposable persistent profile exercises real IndexedDB and reload behavior.
    const profile = await mkdtemp(join(tmpdir(), "polarbear-gantt-reader-"));
    try {
      const persistent = await playwright.webkit.launchPersistentContext(profile, { baseURL, viewport, locale });
      try { await use(persistent); } finally { await persistent.close(); }
    } finally { await rm(profile, { recursive: true, force: true }); }
  },
});

const original = readFileSync(new URL("../../../desktop/tests/fixtures/gantt-original.mmd", import.meta.url), "utf8");

test("the mobile reader renders and reopens the original Gantt without changing source", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  // Inspect the generated Blob without fetching it: the reader's CSP forbids blob connections.
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL);
    const blobs = new Map<string, Blob>();
    Object.assign(window, { __ganttBlobs: blobs });
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob) blobs.set(url, blob);
      return url;
    };
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your reading, wherever you are" })).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "Gantt.md", mimeType: "text/markdown", buffer: Buffer.from(`# Gantt\n\n\`\`\`mermaid\n${original}\`\`\`\n`) });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "Gantt.md Gantt.md" }).click();
    const image = page.locator(".reader-diagram > img");
    await expect(image).toBeVisible({ timeout: 30000 });
    await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const svg = await image.evaluate(async (el) => (window as unknown as { __ganttBlobs: Map<string, Blob> }).__ganttBlobs.get((el as HTMLImageElement).src)!.text());
    expect(svg).toContain("14:40 落库");
    expect(svg).toContain("15:08 再成交");
    expect(svg).not.toMatch(/NaN|Invalid Date/);
    await page.locator(".reader-diagram summary").click();
    expect(await page.locator(".reader-diagram pre").textContent()).toBe(original);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.reload();
  }
  expect(errors).toEqual([]);
});
