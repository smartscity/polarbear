import { parseMarkdownTable, serializeMarkdownTable, tableColumnCount } from "./tableModel";
import type { TableCellPosition, TableSelection } from "./tableTypes";

export function parseTableClipboard(text: string): string[][] | null {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const markdownTable = parseMarkdownTable(normalized.trim());
  if (markdownTable) {
    return [markdownTable.header, ...markdownTable.rows];
  }

  if (!normalized.includes("\t")) {
    return null;
  }

  return normalized.split("\n").map((line) => line.split("\t"));
}

export function pasteTableMatrix(
  rawTable: string,
  row: number,
  column: number,
  matrix: string[][],
): string {
  const table = parseMarkdownTable(rawTable);
  if (!table || matrix.length === 0 || matrix.every((line) => line.length === 0)) {
    return rawTable;
  }

  const requiredColumns = Math.max(
    tableColumnCount(table),
    column + Math.max(...matrix.map((line) => line.length)),
  );
  table.header = resizeRow(table.header, requiredColumns);
  table.alignments = Array.from({ length: requiredColumns }, (_, index) => table.alignments[index] ?? "default");
  table.rows = table.rows.map((source) => resizeRow(source, requiredColumns));

  const requiredBodyRows = Math.max(table.rows.length, row + matrix.length - 1);
  while (table.rows.length < requiredBodyRows) {
    table.rows.push(Array.from({ length: requiredColumns }, () => ""));
  }

  matrix.forEach((values, matrixRow) => {
    const targetRow = row + matrixRow;
    const target = targetRow === 0 ? table.header : table.rows[targetRow - 1];
    if (!target) return;
    values.forEach((value, matrixColumn) => {
      target[column + matrixColumn] = value;
    });
  });

  return serializeMarkdownTable(table);
}

export function tableSelectionAsTsv(rawTable: string, rows: number[], columns: number[]): string {
  const table = parseMarkdownTable(rawTable);
  if (!table) return "";
  const selectedRows = rows.length ? rows : [0, ...table.rows.map((_, index) => index + 1)];
  const selectedColumns = columns.length ? columns : Array.from({ length: tableColumnCount(table) }, (_, index) => index);
  return selectedRows.map((row) => {
    const values = row === 0 ? table.header : table.rows[row - 1] ?? [];
    return selectedColumns.map((column) => values[column] ?? "").join("\t");
  }).join("\n");
}

export function tableSelectionAsMarkdown(rawTable: string, selection: TableSelection): string {
  const table = parseMarkdownTable(rawTable);
  if (!table) return "";
  const matrix = tableSelectionMatrix(table, selection);
  if (matrix.length === 0) return "";
  return serializeMarkdownTable({
    alignments: Array.from({ length: matrix[0]?.length ?? 1 }, () => "default"),
    header: matrix[0] ?? [""],
    rows: matrix.slice(1),
  });
}

export function tableSelectionAsTsvForSelection(rawTable: string, selection: TableSelection): string {
  const table = parseMarkdownTable(rawTable);
  if (!table) return "";
  return tableSelectionMatrix(table, selection).map((row) => row.join("\t")).join("\n");
}

export function tableSelectionPositions(rawTable: string, selection: TableSelection): TableCellPosition[] {
  const table = parseMarkdownTable(rawTable);
  if (!table) return [];
  const rows = selectedRows(table, selection);
  const columns = selectedColumns(table, selection);
  return rows.flatMap((row) => columns.map((column) => ({ row, column })));
}

export function markdownTableFromClipboard(text: string): string | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length < 2 || !lines.every((line) => line.includes("\t"))) return null;
  const header = lines[0]?.split("\t") ?? [];
  const rows = lines.slice(1).map((line) => line.split("\t"));
  const width = Math.max(header.length, ...rows.map((row) => row.length));
  const headerRow = `| ${resizeRow(header, width).join(" | ")} |`;
  const separator = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
  return [headerRow, separator, ...rows.map((row) => `| ${resizeRow(row, width).join(" | ")} |`)].join("\n");
}

function resizeRow(row: string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => row[index] ?? "");
}

function tableSelectionMatrix(
  table: NonNullable<ReturnType<typeof parseMarkdownTable>>,
  selection: TableSelection,
): string[][] {
  const rows = selectedRows(table, selection);
  const columns = selectedColumns(table, selection);
  return rows.map((row) => {
    const values = row === 0 ? table.header : table.rows[row - 1] ?? [];
    return columns.map((column) => values[column] ?? "");
  });
}

function selectedRows(
  table: NonNullable<ReturnType<typeof parseMarkdownTable>>,
  selection: TableSelection,
): number[] {
  if (selection.kind === "row") return selection.rows;
  if (selection.kind === "column" || selection.kind === "table") {
    return [0, ...table.rows.map((_, index) => index + 1)];
  }
  const from = Math.min(selection.anchor.row, selection.head.row);
  const to = Math.max(selection.anchor.row, selection.head.row);
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function selectedColumns(
  table: NonNullable<ReturnType<typeof parseMarkdownTable>>,
  selection: TableSelection,
): number[] {
  if (selection.kind === "column") return selection.columns;
  if (selection.kind === "row" || selection.kind === "table") {
    return Array.from({ length: tableColumnCount(table) }, (_, index) => index);
  }
  const from = Math.min(selection.anchor.column, selection.head.column);
  const to = Math.max(selection.anchor.column, selection.head.column);
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}
