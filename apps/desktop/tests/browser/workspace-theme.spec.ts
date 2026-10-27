import { expect, test } from "@playwright/test";
import { nativeFixture } from "./fixtures/native";

for (const theme of ["light", "dark"] as const) {
  test(`keeps code syntax readable on ${theme} editor surfaces`, async ({ page }) => {
    await nativeFixture(page);
    await page.goto("/");
    await page.locator(".editor-workspace .cm-content").first().click();
    await page.keyboard.insertText('# Colors\n\n```typescript\nconst message = "Readable text";\nconst count = 42;\n// A readable comment\n```\n');
    await expect(page.locator(".cm-typora-code-token-string").first()).toContainText("Readable text");
    await page.evaluate(async (theme) => {
      const path = "/src/features/theme/themeTokens.ts";
      (await import(path)).applyThemeTokens(theme);
    }, theme);
    const contrasts = await page.evaluate(() => {
      const context = document.createElement("canvas").getContext("2d")!;
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3)
          .map((value) => value / 255)
          .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const root = getComputedStyle(document.documentElement);
      const backgrounds = ["--color-code-background", "--color-editor-background"].map((key) => luminance(root.getPropertyValue(key)));
      const classes = [
        ...["keyword", "boolean", "string", "number", "comment", "property", "attr", "tag"].map((token) => `cm-typora-code-token-${token}`),
        ...["keyword", "string", "key", "number", "literal", "comment"].map((token) => `syntax-${token}`),
      ];
      return classes.map((className) => {
        const probe = document.createElement("span");
        probe.className = className;
        document.body.append(probe);
        const foreground = luminance(getComputedStyle(probe).color);
        probe.remove();
        return { className, ratio: Math.min(...backgrounds.map((background) =>
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05))) };
      });
    });
    for (const { className, ratio } of contrasts) expect(ratio, `${theme}: ${className}`).toBeGreaterThanOrEqual(4.5);
  });
}
