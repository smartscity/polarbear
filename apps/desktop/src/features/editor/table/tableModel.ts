import type { MarkdownTable, TableAlignment } from "./tableTypes";

const MIN_TABLE_COLUMN_COUNT = 1;
const MIN_TABLE_SEPARATOR_WIDTH = 3;

export function parseMarkdownTable(rawTable: string): MarkdownTable | null {
  const lines = rawTable.split(/\r?\n/);
  if (lines.length < 2 || !isTableRowLine(lines[0] ?? "") || !isTableSeparatorLine(lines[1] ?? "")) {
    return null;
  }

  const header = parseTableCells(lines[0] ?? "");
  const columnCount = Math.max(MIN_TABLE_COLUMN_COUNT, header.length);
  const alignments = parseTableAlignments(lines[1] ?? "", columnCount);
  const rows = lines.slice(2)
    .filter(isTableRowLine)
    .map((line) => normalizeRow(parseTableCells(line), columnCount));

  return {
    alignments,
    header: normalizeRow(header, columnCount),
    rows,
  };
}

export function serializeMarkdownTable(table: MarkdownTable): string {
  const columnCount = tableColumnCount(table);
  const header = serializeMarkdownTableRow(normalizeRow(table.header, columnCount));
  const separator = serializeMarkdownTableRow(
    Array.from({ length: columnCount }, (_, index) =>
      serializeTableAlignmentCell(table.alignments[index] ?? "default"),
    ),
  );
  const rows = table.rows.map((row) => serializeMarkdownTableRow(normalizeRow(row, columnCount)));
  return [header, separator, ...rows].join("\n");
}

export function parseTableCells(lineText: string): string[] {
  const source = trimOuterTablePipes(lineText.trim());
  const cells: string[] = [];
  let cell = "";
  let codeDelimiter = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (character === "\\" && index + 1 < source.length) {
      const next = source[index + 1] ?? "";
      if (next === "|" || next === "\\") {
        cell += next;
        index += 1;
        continue;
      }
      cell += character;
      continue;
    }

    if (character === "`") {
      const runLength = countBackticks(source, index);
      const delimiter = "`".repeat(runLength);
      if (!codeDelimiter) {
        codeDelimiter = delimiter;
      } else if (codeDelimiter === delimiter) {
        codeDelimiter = "";
      }
      cell += delimiter;
      index += runLength - 1;
      continue;
    }

    if (character === "|" && !codeDelimiter) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(cell.trim());
  return cells;
}

export function parseTableAlignments(separatorLine: string, columnCount: number): TableAlignment[] {
  const cells = parseTableCells(separatorLine);
  return Array.from({ length: columnCount }, (_, index) =>
    parseTableAlignmentCell(cells[index] ?? "---"),
  );
}

export function cssTextAlignForTableAlignment(alignment: TableAlignment): "center" | "left" | "right" {
  return alignment === "center" || alignment === "right" ? alignment : "left";
}

export function tableColumnCount(table: MarkdownTable): number {
  return Math.max(
    MIN_TABLE_COLUMN_COUNT,
    table.header.length,
    table.alignments.length,
    ...table.rows.map((row) => row.length),
  );
}

export function isTableRowLine(lineText: string): boolean {
  return /^\s*\|.*\|\s*$/.test(lineText);
}

export function isTableSeparatorLine(lineText: string): boolean {
  if (!isTableRowLine(lineText)) {
    return false;
  }

  return parseTableCells(lineText).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

export function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

export function unescapeMarkdownTableCell(value: string): string {
  return value.replace(/\\([|\\])/g, "$1").replace(/<br\s*\/?>/gi, "\n");
}

function trimOuterTablePipes(value: string): string {
  let start = 0;
  let end = value.length;
  if (value.startsWith("|")) {
    start = 1;
  }
  if (end > start && value.endsWith("|") && !isEscaped(value, end - 1)) {
    end -= 1;
  }
  return value.slice(start, end);
}

function countBackticks(value: string, start: number): number {
  let count = 0;
  while (value[start + count] === "`") {
    count += 1;
  }
  return count;
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function normalizeRow(row: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
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

function serializeTableAlignmentCell(alignment: TableAlignment): string {
  const dashes = "-".repeat(MIN_TABLE_SEPARATOR_WIDTH);
  if (alignment === "center") return `:${dashes}:`;
  if (alignment === "right") return `${dashes}:`;
  if (alignment === "left") return `:${dashes}`;
  return dashes;
}

function serializeMarkdownTableRow(cells: string[]): string {
  return `| ${cells.map(escapeMarkdownTableCell).join(" | ")} |`;
}
