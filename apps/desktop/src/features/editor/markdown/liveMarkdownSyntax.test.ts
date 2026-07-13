import { describe, expect, it } from "vitest";
import {
  isCalloutStartLine,
  isHorizontalRuleLine,
  isHtmlImageOnlyLine,
  isImageOnlyLine,
  isTableLine,
  isTableRowLine,
  isTableSeparatorLine,
  parseCodeFenceLine,
  parseHtmlAttributes,
} from "./liveMarkdownSyntax";

describe("live Markdown syntax", () => {
  it("parses fenced code markers without including the language in the marker", () => {
    expect(parseCodeFenceLine(12, 22, "  ```typescript")).toEqual({
      lineFrom: 12,
      lineTo: 22,
      markerTo: 17,
      languageFrom: 17,
      languageTo: 22,
      language: "typescript",
    });
    expect(parseCodeFenceLine(0, 4, "text")).toBeNull();
  });

  it("distinguishes table rows from separator rows", () => {
    expect(isTableLine("| Name | Value |")).toBe(true);
    expect(isTableRowLine("| Name | Value |")).toBe(true);
    expect(isTableSeparatorLine("| :--- | ---: |")).toBe(true);
    expect(isTableRowLine("| :--- | ---: |")).toBe(true);
    expect(isTableLine("not a table")).toBe(false);
  });

  it("recognizes isolated Markdown and HTML images", () => {
    expect(isImageOnlyLine("![Alt](images/a.png)")).toBe(true);
    expect(isHtmlImageOnlyLine('<img src="images/a.png" alt="Alt">')).toBe(true);
    expect(isImageOnlyLine("text ![Alt](images/a.png)")).toBe(false);
  });

  it("recognizes callouts and horizontal rules", () => {
    expect(isCalloutStartLine("> [!WARNING] Read this")).toBe(true);
    expect(isHorizontalRuleLine("---")).toBe(true);
    expect(isHorizontalRuleLine("--")).toBe(false);
  });

  it("reads quoted, single-quoted, and unquoted HTML attributes", () => {
    expect(parseHtmlAttributes('<img SRC="one.png" alt=two width=\'120\'>')).toEqual({
      src: "one.png",
      alt: "two",
      width: "120",
    });
  });
});
