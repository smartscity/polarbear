import { describe, expect, it } from "vitest";
import {
  deleteTableColumn,
  parseTableAlignments,
  setTableColumnAlignment,
  updateMarkdownTableCell,
} from "./markdownTable";

describe("markdownTable", () => {
  const table = [
    "| Name | Notes |",
    "| --- | --- |",
    "| Alpha | One |",
  ];

  it("serializes line breaks and pipes when a cell is edited", () => {
    expect(updateMarkdownTableCell(table.join("\n"), 2, 1, "first\nA | B")).toContain(
      "| Alpha | first<br>A \\| B |",
    );
  });

  it("round-trips column alignment markers", () => {
    const aligned = setTableColumnAlignment(table, 1, "center");
    expect(aligned[1]).toBe("| --- | :---: |");
    expect(parseTableAlignments(aligned[1], 2)).toEqual(["default", "center"]);
  });

  it("removes the same column from every table row", () => {
    expect(deleteTableColumn(table, 0)).toEqual([
      "| Notes |",
      "| --- |",
      "| One |",
    ]);
  });
});
