import { describe, expect, it } from "vitest";
import {
  parseMarkdownTable,
  parseTableCells,
  serializeMarkdownTable,
} from "./tableModel";
import {
  deleteTableColumns,
  deleteTableRows,
  clearTableCells,
  clearTableColumns,
  clearTableRows,
  duplicateTableColumns,
  duplicateTableRows,
  insertTableColumns,
  insertTableRow,
  insertTableRows,
  moveTableColumn,
  moveTableRow,
  updateTableCell,
} from "./tableOperations";

const source = [
  "| Name | Notes |",
  "| :--- | ---: |",
  "| Alpha | One |",
  "| Beta | Two |",
].join("\n");

describe("Table model", () => {
  it("parses escaped pipes and inline-code pipes without splitting the cell", () => {
    expect(parseTableCells("| A \\| B | `C | D` | E |")).toEqual([
      "A | B",
      "`C | D`",
      "E",
    ]);
  });

  it("round-trips GFM alignments and compatible multiline cells", () => {
    const table = parseMarkdownTable(source);
    expect(table?.alignments).toEqual(["left", "right"]);
    expect(serializeMarkdownTable(table!)).toContain("| :--- | ---: |");
    expect(updateTableCell(source, 1, 1, "first\nA | B")).toContain(
      "| Alpha | first<br>A \\| B |",
    );
  });

  it("inserts rows and columns at exact boundaries", () => {
    expect(insertTableRow(source, 1)).toContain("|  |  |\n| Alpha | One |");
    expect(insertTableColumns(source, 1)).toContain("| Name |  | Notes |");
    expect(insertTableColumns(source, 0)).toContain("|  | Name | Notes |");
    expect(insertTableColumns(source, 2)).toContain("| Name | Notes |  |");
    expect(insertTableRows(source, 2, 2)).toContain("| Alpha | One |\n|  |  |\n|  |  |\n| Beta | Two |");
  });

  it("keeps the table valid when deleting rows or columns", () => {
    expect(deleteTableRows(source, [1])).not.toContain("| Alpha | One |");
    expect(deleteTableRows(source, [1, 2])).toBe(source);
    expect(deleteTableColumns(source, [0])).toContain("| Notes |");
    expect(deleteTableColumns(source, [0, 1])).toBe(source);
  });

  it("moves complete rows and columns without losing alignment or values", () => {
    expect(moveTableRow(source, 1, 2)).toContain("| Beta | Two |\n| Alpha | One |");
    expect(moveTableColumn(source, 0, 1)).toContain("| Notes | Name |");
  });

  it("duplicates selected row and column ranges without dropping values", () => {
    expect(duplicateTableRows(source, [1, 2])).toContain("| Alpha | One |\n| Alpha | One |\n| Beta | Two |\n| Beta | Two |");
    expect(duplicateTableColumns(source, [0, 1])).toContain("| Name | Name | Notes | Notes |");
  });

  it("clears selected rows, columns, and cell ranges without changing the table shape", () => {
    expect(clearTableRows(source, [1, 2])).toContain("|  |  |\n|  |  |");
    expect(clearTableColumns(source, [0, 1])).toContain("|  |  |");
    expect(clearTableCells(source, [{ row: 0, column: 1 }, { row: 2, column: 0 }])).toContain(
      "| Name |  |\n| :--- | ---: |\n| Alpha | One |\n|  | Two |",
    );
  });
});
