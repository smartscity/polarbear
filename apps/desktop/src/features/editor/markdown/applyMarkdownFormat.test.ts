import { describe, expect, it } from "vitest";
import {
  applyMarkdownFormat,
  minimalMarkdownDocumentChange,
} from "./applyMarkdownFormat";

describe("minimalMarkdownDocumentChange", () => {
  it("changes only the local formatting span", () => {
    expect(minimalMarkdownDocumentChange(
      "Before\nhello\nAfter",
      "Before\n**hello**\nAfter",
    )).toEqual({
      from: 7,
      insert: "**hello**",
      to: 12,
    });
  });

  it("returns no transaction for identical documents", () => {
    expect(minimalMarkdownDocumentChange("same", "same")).toBeNull();
  });

  it("preserves untouched text when a format command adds a wrapper", () => {
    const edit = applyMarkdownFormat(
      "format.bold",
      "Before hello after",
      { from: 7, to: 12 },
    );

    expect(edit).not.toBeNull();
    expect(minimalMarkdownDocumentChange(
      "Before hello after",
      edit?.nextText ?? "",
    )).toEqual({
      from: 7,
      insert: "**hello**",
      to: 12,
    });
  });
});
