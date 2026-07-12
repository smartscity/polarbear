/**
 * @deprecated Table behavior now belongs to `features/editor/table`.
 * This compatibility module keeps older editor imports stable while the live
 * widget moves to the feature API.
 */
export {
  cssTextAlignForTableAlignment,
  parseMarkdownTable,
  parseTableAlignments,
  parseTableCells,
  tableColumnCount as tableModelColumnCount,
} from "../table/tableModel";
export type { TableAlignment } from "../table/tableTypes";

import {
  deleteTableColumns,
  deleteTableRows,
  insertTableColumns,
  insertTableRow as insertTableRowByBoundary,
  resizeTable,
  setTableColumnAlignment as setColumnAlignment,
  updateTableCell,
} from "../table/tableOperations";
import {
  parseMarkdownTable,
  serializeMarkdownTable,
  tableColumnCount as tableModelColumnCount,
} from "../table/tableModel";
import type { TableAlignment } from "../table/tableTypes";

export function updateMarkdownTableCell(
  rawTable: string,
  sourceLineIndex: number,
  columnIndex: number,
  nextValue: string,
): string {
  return updateTableCell(rawTable, sourceLineIndex === 0 ? 0 : Math.max(1, sourceLineIndex - 1), columnIndex, nextValue);
}

export function insertTableRow(lines: string[], lineIndex: number, _focusColumn: number): string[] {
  const raw = lines.join("\n");
  const boundary = Math.max(1, lineIndex - 1);
  return insertTableRowByBoundary(raw, boundary).split("\n");
}

export function insertTableColumn(lines: string[], columnIndex: number): string[] {
  return insertTableColumns(lines.join("\n"), columnIndex).split("\n");
}

export function deleteTableRow(lines: string[], lineIndex: number): string[] {
  const bodyRow = lineIndex - 1;
  return deleteTableRows(lines.join("\n"), [bodyRow]).split("\n");
}

export function deleteTableColumn(lines: string[], columnIndex: number): string[] {
  return deleteTableColumns(lines.join("\n"), [columnIndex]).split("\n");
}

export function setTableColumnAlignment(
  lines: string[],
  columnIndex: number,
  alignment: TableAlignment,
): string[] {
  return setColumnAlignment(lines.join("\n"), columnIndex, alignment).split("\n");
}

export function resizeMarkdownTable(lines: string[], totalRowCount: number, columnCount: number): string[] {
  return resizeTable(lines.join("\n"), Math.max(0, totalRowCount - 1), columnCount).split("\n");
}

export function tableColumnCount(lines: string[]): number {
  return tableColumnCountFromRaw(lines.join("\n"));
}

function tableColumnCountFromRaw(raw: string): number {
  const table = parseMarkdownTable(raw);
  return table ? tableModelColumnCount(table) : 1;
}

export function serializeMarkdownTableForCompatibility(lines: string[]): string {
  const table = parseMarkdownTable(lines.join("\n"));
  return table ? serializeMarkdownTable(table) : lines.join("\n");
}
