import { expect, test } from "@playwright/test";

test("keeps block examples inside code fences as source rather than interactive previews", async ({ page }) => {
  const source = "Before\n\n```markdown\n| A | B |\n| --- | --- |\n| one | two |\n\n![example](missing.png)\n\n> [!NOTE]\n> Example\n```\n\nAfter";
  await page.addInitScript((source) => localStorage.setItem("quality.document", source), source);
  await page.goto("/tests/browser/harness.html");
  await expect(page.locator(".cm-content")).toContainText("After");
  await expect(page.locator(".cm-typora-table-preview")).toHaveCount(0);
  await expect(page.locator(".cm-typora-image-preview")).toHaveCount(0);
  await expect(page.locator(".cm-typora-callout")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__quality.source())).toBe(source);
});

test("preserves mixed block source and disposes table portals when leaving live editing", async ({ page }) => {
  const source = "Before\n\n---\n\n$$\nx^2\n$$\n\n> [!NOTE] Reminder\n> Keep source\n\n| A | B |\n| --- | --- |\n| one | two |\n\n![missing](missing.png)\n\nAfter";
  await page.addInitScript((source) => localStorage.setItem("quality.document", source), source);
  await page.goto("/tests/browser/harness.html");
  await expect(page.locator(".cm-typora-horizontal-rule")).toHaveCount(1);
  await expect(page.locator(".cm-typora-math-block")).toContainText("x");
  await expect(page.locator(".cm-typora-callout")).toContainText("Keep source");
  await expect(page.locator(".cm-typora-image-error")).toContainText("missing.png");
  await page.locator(".cm-typora-table-preview td").first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__quality.source())).toBe(source);
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.locator(".cm-typora-table-preview")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__quality.source())).toBe(source);
});
