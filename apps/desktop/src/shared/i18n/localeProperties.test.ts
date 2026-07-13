import { describe, expect, it } from "vitest";
import { parseLocaleProperties } from "./localeProperties";

describe("parseLocaleProperties", () => {
  it("parses key=value resources and preserves translated punctuation", () => {
    expect(parseLocaleProperties(`
# Translator note
locale.name=English
status.saved=Saved
formula.example=first\\=second
`)).toEqual({
      "locale.name": "English",
      "status.saved": "Saved",
      "formula.example": "first=second",
    });
  });

  it("rejects malformed resource lines", () => {
    expect(() => parseLocaleProperties("status.saved")).toThrow(
      "Expected key=value",
    );
  });

  it("rejects duplicate keys", () => {
    expect(() => parseLocaleProperties("menu.save=Save\nmenu.save=Store")).toThrow(
      'Duplicate locale key "menu.save"',
    );
  });
});
