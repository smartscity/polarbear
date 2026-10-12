import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("reader isolation", () => {
  it("reuses only approved Desktop modules and never imports its app bootstrap", () => {
    const sources = readdirSync(resolve("src"), { recursive: true }).filter((p) => /\.tsx?$/.test(String(p)) && !String(p).endsWith(".test.ts"));
    const allowed = /desktop\/src(?:-tauri\/icons\/128x128\.png|\/(?:shared\/i18n\/I18nProvider|commands\/appCommandRegistry|features\/diagram\/(?:sanitizeDiagramSvg|mermaidRenderer)))$/;
    for (const file of sources) {
      const source = readFileSync(resolve("src", String(file)), "utf8");
      for (const match of source.matchAll(/["']([^"']*desktop\/[^"']+)["']/g)) expect(match[1], String(file)).toMatch(allowed);
      expect(source).not.toMatch(/memory\.db|POLARBEAR_MEMORY_COMMAND/);
    }
  });
  it("keeps reader locales complete in both supported languages", () => {
    const keys = (locale: string) => readFileSync(resolve(`../desktop/src/shared/i18n/locales/${locale}.properties`), "utf8")
      .split("\n").filter((line) => line.startsWith("reader.")).map((line) => line.split("=")[0]).sort();
    expect(keys("en")).toEqual(keys("zh-CN"));
    expect(new Set(keys("en")).size).toBe(keys("en").length);
  });
  it("does not change the default desktop build target", () => {
    const root = JSON.parse(readFileSync(resolve("../../package.json"), "utf8"));
    expect(root.scripts.build).toBe("npm --workspace apps/desktop run build");
    const cargo = readFileSync(resolve("../../Cargo.toml"), "utf8");
    expect(cargo).not.toContain("apps/ios");
  });
});
