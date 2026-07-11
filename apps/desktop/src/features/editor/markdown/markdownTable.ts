import { escapeMarkdownTableCell } from "./tableCellDom";

export type TableAlignment = "center" | "default" | "left" | "right";

export function parseTableCells(lineText: string): string[] {
  return lineText
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseTableAlignments(
  separatorLine: string,
  columnCount: number,
): TableAlignment[] {
  const cells = parseTableCells(separatorLine);
  return Array.from({ length: columnCount }, (_, index) =>
    parseTableAlignmentCell(cells[index] ?? "---"),
  );
}

export function cssTextAlignForTableAlignment(
  alignment: TableAlignment,
): "center" | "left" | "right" {
  return alignment === "center" || alignment === "right" ? alignment : "left";
}

export function updateMarkdownTableCell(
  rawTable: string,
  sourceLineIndex: number,
  columnIndex: number,
  nextValue: string,
): string {
  const lines = rawTable.split(/\r?\n/);
  const line = lines[sourceLineIndex];
  if (!line || !isTableRowLine(line)) {
    return rawTable;
  }

  const cells = parseTableCells(line);
  while (cells.length <= columnIndex) {
    cells.push("");
  }
  cells[columnIndex] = escapeMarkdownTableCell(nextValue);
  lines[sourceLineIndex] = serializeMarkdownTableRow(cells);
  return lines.join("\n");
}

export function insertTableRow(
  lines: string[],
  lineIndex: number,
  _focusColumn: number,
): string[] {
  const row = Array.from({ length: tableColumnCount(lines) }, () => "");
  const nextLines = [...lines];
  nextLines.splice(
    Math.max(2, Math.min(lineIndex, nextLines.length)),
    0,
    serializeMarkdownTableRow(row),
  );
  return nextLines;
}

export function insertTableColumn(lines: string[], columnIndex: number): string[] {
  const columnCount = tableColumnCount(lines);
  const insertAt = Math.max(0, Math.min(columnIndex, columnCount));
  return lines.map((line, lineIndex) => {
    if (!isTableRowLine(line)) {
      return line;
    }
    const cells = parseTableCells(line);
    while (cells.length < columnCount) {
      cells.push("");
    }
    cells.splice(insertAt, 0, lineIndex === 1 ? "---" : "");
    return serializeMarkdownTableRow(cells);
  });
}

export function deleteTableRow(lines: string[], lineIndex: number): string[] {
  if (lineIndex < 2 || lineIndex >= lines.length) {
    return lines;
  }
  return lines.filter((_, index) => index !== lineIndex);
}

export function deleteTableColumn(lines: string[], columnIndex: number): string[] {
  const columnCount = tableColumnCount(lines);
  if (columnCount <= 1) {
    return lines;
  }
  const deleteAt = Math.max(0, Math.min(columnIndex, columnCount - 1));
  return lines.map((line) => {
    if (!isTableRowLine(line)) {
      return line;
    }
    const cells = parseTableCells(line);
    while (cells.length < columnCount) {
      cells.push("");
    }
    cells.splice(deleteAt, 1);
    return serializeMarkdownTableRow(cells);
  });
}

export function setTableColumnAlignment(
  lines: string[],
  columnIndex: number,
  alignment: TableAlignment,
): string[] {
  if (lines.length < 2) {
    return lines;
  }

  const columnCount = tableColumnCount(lines);
  const alignments = parseTableAlignments(lines[1] ?? "", columnCount);
  const targetColumn = Math.max(0, Math.min(columnIndex, columnCount - 1));
  alignments[targetColumn] = alignment;
  const separatorCells = Array.from({ length: columnCount }, (_, index) =>
    serializeTableAlignmentCell(alignments[index] ?? "default"),
  );

  const nextLines = [...lines];
  nextLines[1] = serializeMarkdownTableRow(separatorCells);
  return nextLines;
}

export function resizeMarkdownTable(
  lines: string[],
  totalRowCount: number,
  columnCount: number,
): string[] {
  const rows = lines.filter(isTableRowLine).map(parseTableCells);
  const headers = rows[0] ?? [];
  const alignments = parseTableAlignments(lines[1] ?? "", columnCount);
  const nextLines: string[] = [];

  const normalizeRow = (row: string[] | undefined, fallback: string[] = []) => {
    const cells = [...(row ?? fallback)];
    while (cells.length < columnCount) {
      cells.push("");
    }
    return cells.slice(0, columnCount);
  };

  nextLines.push(serializeMarkdownTableRow(normalizeRow(headers)));
  nextLines.push(serializeMarkdownTableRow(
    Array.from({ length: columnCount }, (_, index) =>
      serializeTableAlignmentCell(alignments[index] ?? "default"),
    ),
  ));

  const bodyRowCount = Math.max(0, totalRowCount - 1);
  for (let rowIndex = 0; rowIndex < bodyRowCount; rowIndex += 1) {
    nextLines.push(serializeMarkdownTableRow(normalizeRow(rows[rowIndex + 2])));
  }
  return nextLines;
}

export function tableColumnCount(lines: string[]): number {
  return Math.max(
    1,
    ...lines.filter(isTableRowLine).map((line) => parseTableCells(line).length),
  );
}

function isTableRowLine(lineText: string): boolean {
  return /^\s*\|.+\|\s*$/.test(lineText);
}

function parseTableAlignmentCell(cell: string): TableAlignment {
  const normalized = cell.trim();
  const starts = normalized.startsWith(":");
  const ends = normalized.endsWith(":");
  if (starts && ends) return "center";
  if (ends) return "right";
  if (starts) return "left";
  return "default";
}

function serializeTableAlignmentCell(alignment: TableAlignment, width = 3): string {
  const dashes = "-".repeat(Math.max(3, width));
  if (alignment === "center") return `:${dashes}:`;
  if (alignment === "right") return `${dashes}:`;
  if (alignment === "left") return `:${dashes}`;
  return dashes;
}

function serializeMarkdownTableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}
