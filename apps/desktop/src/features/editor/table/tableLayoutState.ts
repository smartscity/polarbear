const columnWidthsByTable = new Map<string, number[]>();

export function readTableColumnWidths(tableKey: string): number[] {
  return [...(columnWidthsByTable.get(tableKey) ?? [])];
}

export function setTableColumnWidth(tableKey: string, column: number, width: number): void {
  const widths = readTableColumnWidths(tableKey);
  widths[column] = width;
  columnWidthsByTable.set(tableKey, widths);
}

export function moveTableColumnWidth(tableKey: string, from: number, to: number): void {
  const widths = readTableColumnWidths(tableKey);
  const [width] = widths.splice(from, 1);
  if (width !== undefined) widths.splice(to, 0, width);
  columnWidthsByTable.set(tableKey, widths);
}

export function insertTableColumnWidth(tableKey: string, column: number): void {
  const widths = readTableColumnWidths(tableKey);
  widths.splice(column, 0, 0);
  columnWidthsByTable.set(tableKey, widths);
}

export function removeTableColumnWidths(tableKey: string, columns: number[]): void {
  const targets = new Set(columns);
  columnWidthsByTable.set(
    tableKey,
    readTableColumnWidths(tableKey).filter((_, index) => !targets.has(index)),
  );
}
