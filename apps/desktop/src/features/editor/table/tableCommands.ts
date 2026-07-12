import { APP_COMMANDS } from "../../../shared/commands/appCommandIds";
import {
  clearTableColumns,
  clearTableRows,
  clearTableCells,
  deleteTableColumns,
  deleteTableRows,
  duplicateTableColumns,
  duplicateTableRows,
  insertTableColumns,
  insertTableRow,
  insertTableRows,
  moveTableColumn,
  moveTableRow,
  setTableColumnAlignment,
} from "./tableOperations";
import type { TableAlignment, TableCellPosition } from "./tableTypes";

export const TABLE_COMMANDS = {
  alignmentDefault: APP_COMMANDS.tableAlignmentDefault,
  alignmentLeft: APP_COMMANDS.tableAlignmentLeft,
  alignmentCenter: APP_COMMANDS.tableAlignmentCenter,
  alignmentRight: APP_COMMANDS.tableAlignmentRight,
  cellClear: APP_COMMANDS.tableCellClear,
  columnAutoFit: APP_COMMANDS.tableColumnAutoFit,
  columnClear: APP_COMMANDS.tableColumnClear,
  columnDelete: APP_COMMANDS.tableColumnDelete,
  columnDuplicate: APP_COMMANDS.tableColumnDuplicate,
  columnInsertAfter: APP_COMMANDS.tableColumnInsertAfter,
  columnInsertBefore: APP_COMMANDS.tableColumnInsertBefore,
  columnInsertMultipleAfter: APP_COMMANDS.tableColumnInsertMultipleAfter,
  columnInsertMultipleBefore: APP_COMMANDS.tableColumnInsertMultipleBefore,
  columnMoveLeft: APP_COMMANDS.tableColumnMoveLeft,
  columnMove: APP_COMMANDS.tableColumnMove,
  columnMoveRight: APP_COMMANDS.tableColumnMoveRight,
  columnSelect: APP_COMMANDS.tableColumnSelect,
  copyAsMarkdown: APP_COMMANDS.tableCopyAsMarkdown,
  delete: APP_COMMANDS.tableDelete,
  rowClear: APP_COMMANDS.tableRowClear,
  rowDelete: APP_COMMANDS.tableRowDelete,
  rowDuplicate: APP_COMMANDS.tableRowDuplicate,
  rowInsertAfter: APP_COMMANDS.tableRowInsertAfter,
  rowInsertBefore: APP_COMMANDS.tableRowInsertBefore,
  rowInsertMultipleAfter: APP_COMMANDS.tableRowInsertMultipleAfter,
  rowInsertMultipleBefore: APP_COMMANDS.tableRowInsertMultipleBefore,
  rowMoveDown: APP_COMMANDS.tableRowMoveDown,
  rowMove: APP_COMMANDS.tableRowMove,
  rowMoveUp: APP_COMMANDS.tableRowMoveUp,
  rowSelect: APP_COMMANDS.tableRowSelect,
} as const;

export type TableCommandId = typeof TABLE_COMMANDS[keyof typeof TABLE_COMMANDS];

export type TableCommandContext = {
  column: number;
  count?: number;
  rawTable: string;
  row: number;
  selectedColumns?: number[];
  selectedRows?: number[];
  targetColumn?: number;
  targetRow?: number;
};

export type TableCommandResult = {
  deleteTable?: boolean;
  focus?: TableCellPosition;
  rawTable: string;
};

export function executeTableCommand(
  command: TableCommandId,
  context: TableCommandContext,
): TableCommandResult {
  const selectedColumns = context.selectedColumns?.length ? context.selectedColumns : [context.column];
  const selectedRows = context.selectedRows?.length ? context.selectedRows : [context.row];

  if (command === TABLE_COMMANDS.rowInsertBefore) {
    return withFocus(insertTableRow(context.rawTable, context.row), context.row, context.column);
  }
  if (command === TABLE_COMMANDS.rowInsertMultipleBefore) {
    return withFocus(insertTableRows(context.rawTable, context.row, context.count ?? 1), context.row, context.column);
  }
  if (command === TABLE_COMMANDS.rowInsertMultipleAfter) {
    const row = context.row + 1;
    return withFocus(insertTableRows(context.rawTable, row, context.count ?? 1), row, context.column);
  }
  if (command === TABLE_COMMANDS.rowInsertAfter) {
    return withFocus(insertTableRow(context.rawTable, context.row + 1), context.row + 1, context.column);
  }
  if (command === TABLE_COMMANDS.rowDuplicate) {
    return withFocus(duplicateTableRows(context.rawTable, selectedRows), context.row + 1, context.column);
  }
  if (command === TABLE_COMMANDS.rowMoveUp) {
    const target = Math.max(1, context.row - 1);
    return withFocus(moveTableRow(context.rawTable, context.row, target), target, context.column);
  }
  if (command === TABLE_COMMANDS.rowMoveDown) {
    return withFocus(moveTableRow(context.rawTable, context.row, context.row + 1), context.row + 1, context.column);
  }
  if (command === TABLE_COMMANDS.rowMove && context.targetRow !== undefined) {
    return withFocus(moveTableRow(context.rawTable, context.row, context.targetRow), context.targetRow, context.column);
  }
  if (command === TABLE_COMMANDS.rowClear) {
    return withFocus(clearTableRows(context.rawTable, selectedRows), context.row, context.column);
  }
  if (command === TABLE_COMMANDS.rowDelete) {
    return withFocus(deleteTableRows(context.rawTable, selectedRows), Math.max(1, context.row - 1), context.column);
  }
  if (command === TABLE_COMMANDS.columnInsertBefore) {
    return withFocus(insertTableColumns(context.rawTable, context.column), context.row, context.column);
  }
  if (command === TABLE_COMMANDS.columnInsertMultipleBefore) {
    return withFocus(insertTableColumns(context.rawTable, context.column, context.count ?? 1), context.row, context.column);
  }
  if (command === TABLE_COMMANDS.columnInsertMultipleAfter) {
    const column = context.column + 1;
    return withFocus(insertTableColumns(context.rawTable, column, context.count ?? 1), context.row, column);
  }
  if (command === TABLE_COMMANDS.columnInsertAfter) {
    return withFocus(insertTableColumns(context.rawTable, context.column + 1), context.row, context.column + 1);
  }
  if (command === TABLE_COMMANDS.columnDuplicate) {
    return withFocus(duplicateTableColumns(context.rawTable, selectedColumns), context.row, context.column + 1);
  }
  if (command === TABLE_COMMANDS.columnMoveLeft) {
    const target = Math.max(0, context.column - 1);
    return withFocus(moveTableColumn(context.rawTable, context.column, target), context.row, target);
  }
  if (command === TABLE_COMMANDS.columnMoveRight) {
    return withFocus(moveTableColumn(context.rawTable, context.column, context.column + 1), context.row, context.column + 1);
  }
  if (command === TABLE_COMMANDS.columnMove && context.targetColumn !== undefined) {
    return withFocus(moveTableColumn(context.rawTable, context.column, context.targetColumn), context.row, context.targetColumn);
  }
  if (command === TABLE_COMMANDS.columnClear) {
    return withFocus(clearTableColumns(context.rawTable, selectedColumns), context.row, context.column);
  }
  if (command === TABLE_COMMANDS.columnDelete) {
    return withFocus(deleteTableColumns(context.rawTable, selectedColumns), context.row, Math.max(0, context.column - 1));
  }
  if (command === TABLE_COMMANDS.cellClear) {
    return withFocus(clearCells(context.rawTable, context), context.row, context.column);
  }
  if (command === TABLE_COMMANDS.alignmentDefault) return withFocus(setAlignment(context, "default"), context.row, context.column);
  if (command === TABLE_COMMANDS.alignmentLeft) return withFocus(setAlignment(context, "left"), context.row, context.column);
  if (command === TABLE_COMMANDS.alignmentCenter) return withFocus(setAlignment(context, "center"), context.row, context.column);
  if (command === TABLE_COMMANDS.alignmentRight) return withFocus(setAlignment(context, "right"), context.row, context.column);
  if (command === TABLE_COMMANDS.delete) return { rawTable: "", deleteTable: true };

  return { rawTable: context.rawTable };
}

function clearCells(rawTable: string, context: TableCommandContext): string {
  const rows = context.selectedRows?.length ? context.selectedRows : [context.row];
  const columns = context.selectedColumns?.length ? context.selectedColumns : [context.column];
  return clearTableCells(rawTable, rows.flatMap((row) => columns.map((column) => ({ row, column }))));
}

function setAlignment(context: TableCommandContext, alignment: TableAlignment): string {
  const columns = context.selectedColumns?.length ? context.selectedColumns : [context.column];
  return columns.reduce(
    (rawTable, column) => setTableColumnAlignment(rawTable, column, alignment),
    context.rawTable,
  );
}

function withFocus(rawTable: string, row: number, column: number): TableCommandResult {
  return { rawTable, focus: { row, column } };
}
