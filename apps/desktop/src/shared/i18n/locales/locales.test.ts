import { describe, expect, it } from "vitest";
import { localeMessages, localeOptions } from "../translate";

describe("locale resources", () => {
  it("keeps every locale aligned with the English key baseline", () => {
    const englishKeys = Object.keys(localeMessages("en")).sort();

    localeOptions.forEach(({ code }) => {
      expect(Object.keys(localeMessages(code)).sort()).toEqual(englishKeys);
    });
  });

  it("uses the short user-facing Quit label", () => {
    expect(localeMessages("en")["menu.quit"]).toBe("Quit");
    expect(localeMessages("en")["menu.quit"]).not.toContain("Polarbear Desktop");
  });

  it("discovers locale files without a TypeScript registry", () => {
    const languageCodes = localeOptions.map(({ code }) => code);

    expect(languageCodes).toContain("en");
    expect(languageCodes).toContain("zh-CN");
  });
});
