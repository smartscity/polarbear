import {
  parseMarkdownTable,
  serializeMarkdownTable,
  tableColumnCount,
} from "./tableModel";
import type { MarkdownTable, TableAlignment } from "./tableTypes";

export function updateTableCell(rawTable: string, row: number, column: number, value: string): string {
  return mutateTable(rawTable, (table) => {
    const target = row === 0 ? table.header : table.rows[row - 1];
    if (!target) return table;
    target[column] = value;
    return table;
  });
}

export function insertTableRow(rawTable: string, boundary: number): string {
  return insertTableRows(rawTable, boundary, 1);
}

export function insertTableRows(rawTable: string, boundary: number, count: number): string {
  return mutateTable(rawTable, (table) => {
    const columnCount = tableColumnCount(table);
    const target = Math.max(1, Math.min(boundary, table.rows.length + 1));
    const rows = Array.from(
      { length: Math.max(1, count) },
      () => Array.from({ length: columnCount }, () => ""),
    );
    table.rows.splice(target - 1, 0, ...rows);
    return table;
  });
}

export function insertTableColumns(rawTable: string, boundary: number, count = 1): string {
  return mutateTable(rawTable, (table) => {
    const insertAt = Math.max(0, Math.min(boundary, tableColumnCount(table)));
    const columnCount = Math.max(1, count);
    table.header.splice(insertAt, 0, ...Array.from({ length: columnCount }, () => ""));
    table.alignments.splice(insertAt, 0, ...Array.from({ length: columnCount }, () => "default" as const));
    table.rows.forEach((row) => row.splice(insertAt, 0, ...Array.from({ length: columnCount }, () => "")));
    return table;
  });
}

export function deleteTableRows(rawTable: string, rows: number[]): string {
  return mutateTable(rawTable, (table) => {
    const targets = new Set(rows.filter((row) => row > 0 && row <= table.rows.length));
    if (targets.size === 0 || targets.size === table.rows.length) {
      return table;
    }
    table.rows = table.rows.filter((_, index) => !targets.has(index + 1));
    return table;
  });
}

export function deleteTableColumns(rawTable: string, columns: number[]): string {
  return mutateTable(rawTable, (table) => {
    const width = tableColumnCount(table);
    const targets = new Set(columns.filter((column) => column >= 0 && column < width));
    if (targets.size === 0 || targets.size === width) {
      return table;
    }
    table.header = table.header.filter((_, index) => !targets.has(index));
    table.alignments = table.alignments.filter((_, index) => !targets.has(index));
    table.rows = table.rows.map((row) => row.filter((_, index) => !targets.has(index)));
    return table;
  });
}

export function duplicateTableRow(rawTable: string, row: number): string {
  return duplicateTableRows(rawTable, [row]);
}

export function duplicateTableRows(rawTable: string, rows: number[]): string {
  return mutateTable(rawTable, (table) => {
    const targets = new Set(rows.filter((row) => row > 0 && row <= table.rows.length));
    if (targets.size === 0) return table;
    table.rows = table.rows.flatMap((row, index) =>
      targets.has(index + 1) ? [row, [...row]] : [row],
    );
    return table;
  });
}

export function duplicateTableColumn(rawTable: string, column: number): string {
  return duplicateTableColumns(rawTable, [column]);
}

export function duplicateTableColumns(rawTable: string, columns: number[]): string {
  return mutateTable(rawTable, (table) => {
    const width = tableColumnCount(table);
    const targets = new Set(columns.filter((column) => column >= 0 && column < width));
    if (targets.size === 0) return table;
    table.header = duplicateItems(table.header, targets);
    table.alignments = duplicateItems(table.alignments, targets);
    table.rows = table.rows.map((row) => duplicateItems(row, targets));
    return table;
  });
}

export function moveTableRow(rawTable: string, row: number, targetRow: number): string {
  return mutateTable(rawTable, (table) => {
    if (row < 1 || row > table.rows.length || targetRow < 1 || targetRow > table.rows.length || row === targetRow) {
      return table;
    }
    const [moved] = table.rows.splice(row - 1, 1);
    if (moved) table.rows.splice(targetRow - 1, 0, moved);
    return table;
  });
}

export function moveTableColumn(rawTable: string, column: number, targetColumn: number): string {
  return mutateTable(rawTable, (table) => {
    const width = tableColumnCount(table);
    if (column < 0 || column >= width || targetColumn < 0 || targetColumn >= width || column === targetColumn) {
      return table;
    }
    moveItem(table.header, column, targetColumn);
    moveItem(table.alignments, column, targetColumn);
    table.rows.forEach((row) => moveItem(row, column, targetColumn));
    return table;
  });
}

export function setTableColumnAlignment(rawTable: string, column: number, alignment: TableAlignment): string {
  return mutateTable(rawTable, (table) => {
    if (column < 0 || column >= tableColumnCount(table)) return table;
    table.alignments[column] = alignment;
    return table;
  });
}

export function clearTableRow(rawTable: string, row: number): string {
  return clearTableRows(rawTable, [row]);
}

export function clearTableRows(rawTable: string, rows: number[]): string {
  return mutateTable(rawTable, (table) => {
    for (const row of new Set(rows)) {
      const target = row === 0 ? table.header : table.rows[row - 1];
      if (target) target.fill("");
    }
    return table;
  });
}

export function clearTableColumn(rawTable: string, column: number): string {
  return clearTableColumns(rawTable, [column]);
}

export function clearTableColumns(rawTable: string, columns: number[]): string {
  return mutateTable(rawTable, (table) => {
    const targets = new Set(columns.filter((column) => column >= 0 && column < tableColumnCount(table)));
    for (const column of targets) {
      table.header[column] = "";
      table.rows.forEach((row) => {
        row[column] = "";
      });
    }
    return table;
  });
}

export function clearTableCells(rawTable: string, cells: Array<{ row: number; column: number }>): string {
  return mutateTable(rawTable, (table) => {
    for (const { row, column } of cells) {
      const target = row === 0 ? table.header : table.rows[row - 1];
      if (target && column >= 0 && column < target.length) {
        target[column] = "";
      }
    }
    return table;
  });
}

export function resizeTable(rawTable: string, bodyRows: number, columns: number): string {
  return mutateTable(rawTable, (table) => {
    const nextColumns = Math.max(1, columns);
    table.header = resizeRow(table.header, nextColumns);
    table.alignments = resizeAlignments(table.alignments, nextColumns);
    table.rows = table.rows.slice(0, Math.max(0, bodyRows)).map((row) => resizeRow(row, nextColumns));
    while (table.rows.length < Math.max(0, bodyRows)) {
      table.rows.push(Array.from({ length: nextColumns }, () => ""));
    }
    return table;
  });
}

export function tableCellAt(rawTable: string, row: number, column: number): string | null {
  const table = parseMarkdownTable(rawTable);
  if (!table) return null;
  const source = row === 0 ? table.header : table.rows[row - 1];
  return source?.[column] ?? null;
}

function mutateTable(rawTable: string, operation: (table: MarkdownTable) => MarkdownTable): string {
  const parsed = parseMarkdownTable(rawTable);
  if (!parsed) return rawTable;
  const next = operation({
    alignments: [...parsed.alignments],
    header: [...parsed.header],
    rows: parsed.rows.map((row) => [...row]),
  });
  return serializeMarkdownTable(next);
}

function moveItem<T>(items: T[], from: number, to: number): void {
  const [item] = items.splice(from, 1);
  if (item !== undefined) items.splice(to, 0, item);
}

function duplicateItems<T>(items: T[], targets: Set<number>): T[] {
  return items.flatMap((item, index) => targets.has(index) ? [item, item] : [item]);
}

function resizeRow(row: string[], columns: number): string[] {
  return Array.from({ length: columns }, (_, index) => row[index] ?? "");
}

function resizeAlignments(alignments: TableAlignment[], columns: number): TableAlignment[] {
  return Array.from({ length: columns }, (_, index) => alignments[index] ?? "default");
}
