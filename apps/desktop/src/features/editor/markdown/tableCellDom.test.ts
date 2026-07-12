import { describe, expect, it } from "vitest";
import { escapeMarkdownTableCell, normalizeTableCellText } from "./tableCellDom";

describe("tableCellDom", () => {
  it("keeps real line breaks while removing only outer horizontal whitespace", () => {
    expect(normalizeTableCellText("  first\nsecond  ")).toBe("first\nsecond");
    expect(normalizeTableCellText("\nsecond")).toBe("\nsecond");
  });

  it("serializes table-sensitive content reversibly", () => {
    expect(escapeMarkdownTableCell("first\nA | B")).toBe("first<br>A \\| B");
  });
});
