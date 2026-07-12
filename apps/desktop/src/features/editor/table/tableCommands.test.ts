import { describe, expect, it } from "vitest";
import { TABLE_COMMANDS, executeTableCommand } from "./tableCommands";

const source = [
  "| Name | Notes |",
  "| --- | --- |",
  "| Alpha | One |",
].join("\n");

describe("Table commands", () => {
  it("routes gap insertion through a single table command", () => {
    const result = executeTableCommand(TABLE_COMMANDS.columnInsertBefore, {
      rawTable: source,
      row: 1,
      column: 1,
    });

    expect(result.rawTable).toContain("| Name |  | Notes |");
    expect(result.focus).toEqual({ row: 1, column: 1 });
  });

  it("inserts a final body row with a predictable focus target", () => {
    const result = executeTableCommand(TABLE_COMMANDS.rowInsertBefore, {
      rawTable: source,
      row: 2,
      column: 0,
    });

    expect(result.rawTable).toContain("| Alpha | One |\n|  |  |");
    expect(result.focus).toEqual({ row: 2, column: 0 });
  });

  it("keeps alignment writes and clear-cell writes transactional", () => {
    const aligned = executeTableCommand(TABLE_COMMANDS.alignmentCenter, {
      rawTable: source,
      row: 1,
      column: 1,
    });
    expect(aligned.rawTable).toContain("| --- | :---: |");

    const cleared = executeTableCommand(TABLE_COMMANDS.cellClear, {
      rawTable: source,
      row: 1,
      column: 1,
    });
    expect(cleared.rawTable).toContain("| Alpha |  |");
  });

  it("applies a selected column range in one transaction", () => {
    const result = executeTableCommand(TABLE_COMMANDS.alignmentRight, {
      rawTable: source,
      row: 1,
      column: 0,
      selectedColumns: [0, 1],
    });

    expect(result.rawTable).toContain("| ---: | ---: |");
  });

  it("inserts multiple rows and columns through the same command dispatcher", () => {
    const rows = executeTableCommand(TABLE_COMMANDS.rowInsertMultipleAfter, {
      rawTable: source,
      row: 1,
      column: 0,
      count: 3,
    });
    expect(rows.rawTable.match(/\|\s{2}\|\s{2}\|/g)).toHaveLength(3);

    const columns = executeTableCommand(TABLE_COMMANDS.columnInsertMultipleBefore, {
      rawTable: source,
      row: 1,
      column: 1,
      count: 2,
    });
    expect(columns.rawTable).toContain("| Name |  |  | Notes |");
  });
});
