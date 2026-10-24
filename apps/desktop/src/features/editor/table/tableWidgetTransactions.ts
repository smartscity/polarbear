import { EditorSelection, Transaction, type StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { placeCaretAtEnd } from "../markdown/tableCellDom";
import { TABLE_COMMANDS, executeTableCommand, type TableCommandId } from "../table/tableCommands";
import { tableSelectionPositions } from "../table/tableClipboard";
import { readTableInteractionState } from "../table/tableInteractionState";
import { readTableColumnWidths, tableWidthsEffect, tableWidthsForCommand } from "../table/tableLayoutState";
import { parseMarkdownTable } from "../table/tableModel";
import type { TableCellPosition, TableSelection } from "../table/tableTypes";
import type { PreviewBlock } from "../markdown/previewBlocks";
import { autoFitTableColumn } from "./tableColumnSizing";

export function applyTableOperation(
  wrapper: HTMLElement,
  block: PreviewBlock,
  operation: (lines: string[]) => string[],
) {
  const nextRaw = operation(block.raw.split(/\r?\n/)).join("\n");
  applyTableEdit(wrapper, block, nextRaw);
}

export function applyTableCommand(
  wrapper: HTMLElement,
  block: PreviewBlock,
  command: TableCommandId,
  position: TableCellPosition,
  target?: { count?: number; targetColumn?: number; targetRow?: number },
) {
  if (command === TABLE_COMMANDS.columnAutoFit) {
    const table = wrapper.querySelector<HTMLTableElement>("table");
    if (table) {
      autoFitTableColumn(table, block.from, position.column);
    }
    return;
  }

  const selection = readTableInteractionState(wrapper).selection;
  const selected = tableSelectionIndices(block.raw, selection, position);
  const context = {
    rawTable: block.raw,
    row: position.row,
    column: position.column,
    selectedColumns: selected.columns,
    selectedRows: selected.rows,
    ...target,
  };
  const result = executeTableCommand(command, context);
  const view = EditorView.findFromDOM(wrapper);
  if (!view) return;
  const widths = tableWidthsForCommand(readTableColumnWidths(view.state, block.from), command, context, result.rawTable);
  applyTableEdit(wrapper, block, result.rawTable, result.focus, [tableWidthsEffect(view.state, block.from, widths)]);
}

function tableSelectionIndices(
  rawTable: string,
  selection: TableSelection | null,
  fallback: TableCellPosition,
): { columns: number[]; rows: number[] } {
  const table = parseMarkdownTable(rawTable);
  if (!table || !selection) {
    return { columns: [fallback.column], rows: [fallback.row] };
  }
  const positions = tableSelectionPositions(rawTable, selection);
  const rows = Array.from(new Set(positions.map((position) => position.row)));
  const columns = Array.from(new Set(positions.map((position) => position.column)));
  return {
    columns: columns.length ? columns : [fallback.column],
    rows: rows.length ? rows : [fallback.row],
  };
}

export function applyTableEdit(
  wrapper: HTMLElement,
  block: PreviewBlock,
  nextRaw: string,
  focus?: TableCellPosition,
  effects?: StateEffect<unknown>[],
  userEvent: "input.table" | "input.tableCell" = "input.table",
) {
  const view = EditorView.findFromDOM(wrapper);
  if (!view) {
    return;
  }

  const scrollDOM = view.scrollDOM;
  const scrollTop = scrollDOM.scrollTop;
  const scrollLeft = scrollDOM.scrollLeft;
  prepareTableHistorySelection(view, block.from);

  view.dispatch({
    changes: {
      from: block.from,
      to: block.to,
      insert: nextRaw,
    },
    scrollIntoView: false,
    userEvent,
    effects,
  });
  scrollDOM.scrollTop = scrollTop;
  scrollDOM.scrollLeft = scrollLeft;

  if (focus) {
    focusTableCellAtAfterCommit(view, block.from, focus);
  }
}

export function runTableHistoryAction(
  wrapper: HTMLElement,
  focusedCell: TableCellPosition,
  action: (view: EditorView) => boolean,
) {
  const view = EditorView.findFromDOM(wrapper);
  if (!view) return;

  const scrollTop = view.scrollDOM.scrollTop;
  const scrollLeft = view.scrollDOM.scrollLeft;
  const tableKey = wrapper.dataset.tableKey;
  if (!action(view)) return;

  restoreTableHistoryViewport(view, tableKey, focusedCell, scrollTop, scrollLeft);
}

function restoreTableHistoryViewport(
  view: EditorView,
  tableKey: string | undefined,
  focusedCell: TableCellPosition,
  scrollTop: number,
  scrollLeft: number,
) {
  const expectedDocument = view.state.doc;
  const restore = () => {
    if (!view.dom.isConnected || view.state.doc !== expectedDocument) return true;
    restoreTableHistoryScrollPosition(view, scrollTop, scrollLeft);

    if (!tableKey) return true;
    const nextWrapper = findTablePreviewWrapper(view, tableKey);
    const nextCell = nextWrapper
      ? findNearestTableCell(nextWrapper, focusedCell)
      : null;
    if (!nextCell) return false;

    nextCell.focus({ preventScroll: true });
    placeCaretAtEnd(nextCell);
    restoreTableHistoryScrollPosition(view, scrollTop, scrollLeft);
    return true;
  };

  // Widgets are recreated by the history transaction. One retry covers the next
  // paint without continuously overwriting the user's scroll position.
  window.requestAnimationFrame(() => {
    if (restore()) return;
    window.requestAnimationFrame(restore);
  });
}

function restoreTableHistoryScrollPosition(
  view: EditorView,
  scrollTop: number,
  scrollLeft: number,
) {
  const scrollDOM = view.scrollDOM;
  // Let the browser clamp against the current layout. Manually clamping during
  // a widget rebuild can observe a transient zero-height scroll range and send
  // the document to its top edge.
  scrollDOM.scrollTop = scrollTop;
  scrollDOM.scrollLeft = scrollLeft;
}

export function prepareTableHistorySelection(view: EditorView, position: number): void {
  if (view.state.selection.main.head === position) {
    return;
  }

  view.dispatch({
    selection: EditorSelection.cursor(position),
    scrollIntoView: false,
    annotations: Transaction.addToHistory.of(false),
  });
}

function findTablePreviewWrapper(view: EditorView, tableKey: string): HTMLElement | null {
  return Array.from(view.dom.querySelectorAll<HTMLElement>(".cm-typora-table-preview")).find(
    (candidate) => candidate.dataset.tableKey === tableKey,
  ) ?? null;
}

function findNearestTableCell(
  wrapper: HTMLElement,
  position: TableCellPosition,
): HTMLElement | null {
  const cells = Array.from(wrapper.querySelectorAll<HTMLElement>("[data-table-row][data-table-column]"));
  if (cells.length === 0) return null;

  return cells.reduce((nearest, cell) => {
    const row = Number(cell.dataset.tableRow);
    const column = Number(cell.dataset.tableColumn);
    const nearestRow = Number(nearest.dataset.tableRow);
    const nearestColumn = Number(nearest.dataset.tableColumn);
    const distance = Math.abs(row - position.row) + Math.abs(column - position.column);
    const nearestDistance =
      Math.abs(nearestRow - position.row) + Math.abs(nearestColumn - position.column);
    return distance < nearestDistance ? cell : nearest;
  });
}

function focusTableCellAtAfterCommit(
  view: EditorView,
  blockFrom: number,
  position: TableCellPosition,
) {
  const expectedDocument = view.state.doc;
  const focusCell = (): boolean => {
    if (!view.dom.isConnected || view.state.doc !== expectedDocument) return true;
    const nextWrapper = view.dom.querySelector<HTMLElement>(
      `.cm-typora-table-preview[data-table-key="${blockFrom}"]`,
    );
    const nextCell = nextWrapper?.querySelector<HTMLElement>(
      `[data-table-row="${position.row}"][data-table-column="${position.column}"]`,
    );
    if (!nextCell) return false;
    nextCell.focus({ preventScroll: true });
    placeCaretAtEnd(nextCell);
    return true;
  };

  let remainingFrames = 4;
  const retryFocus = () => {
    if (focusCell() || remainingFrames <= 0) return;
    remainingFrames -= 1;
    window.requestAnimationFrame(retryFocus);
  };
  window.requestAnimationFrame(retryFocus);
}

export function focusTableCellAfterCommit(
  view: EditorView | null,
  blockFrom: number,
  focusIndex: number,
) {
  if (!view || focusIndex < 0) {
    return;
  }

  const expectedDocument = view.state.doc;
  const focusCell = (): boolean => {
    if (!view.dom.isConnected || view.state.doc !== expectedDocument) return true;
    const nextWrapper = view.dom.querySelector<HTMLElement>(
      `.cm-typora-table-preview[data-table-key="${blockFrom}"]`,
    );
    const nextCell = nextWrapper?.querySelector<HTMLElement>(
      `[data-table-focus-index="${focusIndex}"]`,
    );
    if (!nextCell) return false;

    nextCell.focus({ preventScroll: true });
    placeCaretAtEnd(nextCell);
    return true;
  };

  let remainingFrames = 4;
  const retryFocus = () => {
    if (focusCell() || remainingFrames <= 0) return;
    remainingFrames -= 1;
    window.requestAnimationFrame(retryFocus);
  };
  window.requestAnimationFrame(retryFocus);
}
