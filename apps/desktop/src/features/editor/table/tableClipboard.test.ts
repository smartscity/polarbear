import { describe, expect, it } from "vitest";
import {
  parseTableClipboard,
  pasteTableMatrix,
  tableSelectionAsMarkdown,
  tableSelectionAsTsv,
  tableSelectionAsTsvForSelection,
  tableSelectionPositions,
} from "./tableClipboard";

const source = [
  "| Name | Notes |",
  "| --- | --- |",
  "| Alpha | One |",
].join("\n");

describe("Table clipboard", () => {
  it("recognizes tab-separated spreadsheet data without treating plain multiline text as a matrix", () => {
    expect(parseTableClipboard("A\tB\nC\tD")).toEqual([["A", "B"], ["C", "D"]]);
    expect(parseTableClipboard("first line\nsecond line")).toBeNull();
  });

  it("pastes a matrix in one structural table update and expands rows and columns", () => {
    const next = pasteTableMatrix(source, 1, 1, [["A", "B"], ["C", "D"]]);
    expect(next).toContain("| Alpha | A | B |");
    expect(next).toContain("|  | C | D |");
  });

  it("exports selected cells as spreadsheet-friendly TSV", () => {
    expect(tableSelectionAsTsv(source, [0, 1], [0, 1])).toBe("Name\tNotes\nAlpha\tOne");
  });

  it("exports a cell range as both TSV and compatible Markdown", () => {
    const selection = {
      kind: "cell" as const,
      anchor: { row: 0, column: 0 },
      head: { row: 1, column: 1 },
    };
    expect(tableSelectionAsTsvForSelection(source, selection)).toBe("Name\tNotes\nAlpha\tOne");
    expect(tableSelectionAsMarkdown(source, selection)).toContain("| Name | Notes |");
    expect(tableSelectionPositions(source, selection)).toEqual([
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 1, column: 0 },
      { row: 1, column: 1 },
    ]);
  });
});
