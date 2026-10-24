import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { translateCurrent } from "../../../shared/i18n/translate";
import { hasPrimaryModifier } from "../../../shared/platform/keyboard";
import type { KeybindingOverrides } from "../../../shared/settings/userSettings";
import { matchesCommandShortcut } from "../../../commands/keybindingResolver";
import { insertLineBreakAtCurrentSelection, markdownFromTableCellElement, placeCaretAtEnd, renderTableCellValue } from "../markdown/tableCellDom";
import { updateMarkdownTableCell } from "../markdown/markdownTable";
import { TABLE_COMMANDS, executeTableCommand } from "../table/tableCommands";
import { parseTableClipboard, pasteTableMatrix } from "../table/tableClipboard";
import { clearTableSelection, selectTableCell, setTableCellEditing } from "../table/tableInteractionDom";
import { readTableInteractionState, updateTableInteractionState } from "../table/tableInteractionState";
import { parseMarkdownTable } from "../table/tableModel";
import type { TableCellPosition } from "../table/tableTypes";
import type { PreviewBlock } from "../markdown/previewBlocks";
import { openTableActionMenu } from "./tableWidgetMenus";
import { applyTableCommand, applyTableEdit, runTableHistoryAction, focusTableCellAfterCommit } from "./tableWidgetTransactions";
import { writeTableSelectionToClipboard } from "./tableWidgetClipboard";

export function makeTableCellEditable(
  cell: HTMLTableCellElement,
  params: {
    block: PreviewBlock;
    columnIndex: number;
    focusIndex: number;
    rowIndex: number;
    sourceLineIndex: number;
    value: string;
    wrapper: HTMLElement;
    keybindingOverrides: KeybindingOverrides;
  },
) {
  cell.contentEditable = "true";
  cell.spellcheck = true;
  renderTableCellValue(cell, params.value);
  cell.setAttribute("role", "textbox");
  cell.setAttribute("aria-label", translateCurrent("table.editCell"));
  cell.dataset.tableFocusIndex = String(params.focusIndex);
  cell.dataset.tableRow = String(params.rowIndex);
  cell.dataset.tableColumn = String(params.columnIndex);

  let committedValue = params.value;

  const commit = (): boolean => {
    const nextValue = markdownFromTableCellElement(cell);
    if (nextValue === committedValue) {
      return true;
    }

    const view = EditorView.findFromDOM(params.wrapper);
    if (!view) {
      renderTableCellValue(cell, committedValue);
      return false;
    }

    const nextRaw = updateMarkdownTableCell(
      params.block.raw,
      params.sourceLineIndex,
      params.columnIndex,
      nextValue,
    );

    if (nextRaw === params.block.raw) {
      renderTableCellValue(cell, committedValue);
      return false;
    }

    committedValue = nextValue;
    applyTableEdit(params.wrapper, params.block, nextRaw, undefined, undefined, "input.tableCell");
    return true;
  };

  cell.addEventListener("mousedown", (event) => {
    cell.dataset.tableExtendSelection = event.shiftKey ? "true" : "false";
    selectTableCell(
      params.wrapper,
      { row: params.rowIndex, column: params.columnIndex },
      event.shiftKey,
    );
    event.stopPropagation();
  });
  cell.addEventListener("click", (event) => {
    if (document.activeElement !== cell) {
      cell.focus({ preventScroll: true });
    }
    event.stopPropagation();
  });
  cell.addEventListener("input", (event) => event.stopPropagation());
  cell.addEventListener("paste", (event) => {
    const clipboardText = event.clipboardData?.getData("text/plain") ?? "";
    const matrix = parseTableClipboard(clipboardText);
    if (!matrix) return;

    event.preventDefault();
    event.stopPropagation();
    const nextRaw = pasteTableMatrix(
      params.block.raw,
      params.rowIndex,
      params.columnIndex,
      matrix,
    );
    applyTableEdit(params.wrapper, params.block, nextRaw, {
      row: params.rowIndex,
      column: params.columnIndex,
    });
  });
  cell.addEventListener("copy", (event) => {
    writeTableSelectionToClipboard(event, params.wrapper, params.block.raw);
  });
  cell.addEventListener("cut", (event) => {
    if (!writeTableSelectionToClipboard(event, params.wrapper, params.block.raw)) return;
    applyTableCommand(params.wrapper, params.block, TABLE_COMMANDS.cellClear, {
      row: params.rowIndex,
      column: params.columnIndex,
    });
  });
  cell.addEventListener("focus", () => {
    params.wrapper.dataset.activeColumn = String(params.columnIndex);
    const extend = cell.dataset.tableExtendSelection === "true";
    selectTableCell(
      params.wrapper,
      { row: params.rowIndex, column: params.columnIndex },
      extend,
    );
    setTableCellEditing(params.wrapper, { row: params.rowIndex, column: params.columnIndex });
    cell.dataset.tableExtendSelection = "false";
  });
  cell.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTableActionMenu(params.wrapper, params.block, cell, {
      columnIndex: params.columnIndex,
      sourceLineIndex: params.sourceLineIndex,
    });
  });
  cell.addEventListener("blur", () => {
    commit();
    setTableCellEditing(params.wrapper, null);
  });
  cell.addEventListener("keydown", (event) => {
    event.stopPropagation();

    if (event.isComposing || event.key === "Process") {
      return;
    }

    if (matchesTableCellCommand(event, "edit.undo", params.keybindingOverrides)) {
      event.preventDefault();
      runTableHistoryAction(
        params.wrapper,
        { row: params.rowIndex, column: params.columnIndex },
        undo,
      );
      return;
    }
    if (suppressesDefaultTableCellCommand(event, "edit.undo", params.keybindingOverrides)) {
      event.preventDefault();
      return;
    }

    if (matchesTableCellCommand(event, "edit.redo", params.keybindingOverrides)) {
      event.preventDefault();
      runTableHistoryAction(
        params.wrapper,
        { row: params.rowIndex, column: params.columnIndex },
        redo,
      );
      return;
    }
    if (suppressesDefaultTableCellCommand(event, "edit.redo", params.keybindingOverrides)) {
      event.preventDefault();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const nextFocusIndex = params.focusIndex + (event.shiftKey ? -1 : 1);
      const tableCellCount = params.wrapper.querySelectorAll("[data-table-focus-index]").length;
      if (!event.shiftKey && nextFocusIndex >= tableCellCount) {
        const model = parseMarkdownTable(params.block.raw);
        const nextRow = (model?.rows.length ?? 0) + 1;
        const currentRaw = updateMarkdownTableCell(
          params.block.raw,
          params.sourceLineIndex,
          params.columnIndex,
          markdownFromTableCellElement(cell),
        );
        committedValue = markdownFromTableCellElement(cell);
        const result = executeTableCommand(TABLE_COMMANDS.rowInsertBefore, {
          rawTable: currentRaw,
          row: nextRow,
          column: 0,
        });
        applyTableEdit(params.wrapper, params.block, result.rawTable, result.focus);
        return;
      }
      const view = EditorView.findFromDOM(params.wrapper);
      if (commit()) {
        focusTableCellAfterCommit(view, params.block.from, nextFocusIndex);
      }
      return;
    }

    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      insertLineBreakAtCurrentSelection(cell);
      return;
    }

    if (event.key === "Enter") {
      if (hasPrimaryModifier(event)) {
        event.preventDefault();
        insertLineBreakAtCurrentSelection(cell);
        return;
      }
      if (cell.querySelector(".cm-typora-table-cell-list")) {
        return;
      }
      commit();
      cell.blur();
      return;
    }

    if (matchesTableCellCommand(event, "format.bold", params.keybindingOverrides)) {
      event.preventDefault();
      document.execCommand("bold");
      return;
    }
    if (suppressesDefaultTableCellCommand(event, "format.bold", params.keybindingOverrides)) {
      event.preventDefault();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      renderTableCellValue(cell, committedValue);
      cell.blur();
      params.wrapper.focus({ preventScroll: true });
    }
  });
}

function matchesTableCellCommand(
  event: KeyboardEvent,
  command: "edit.redo" | "edit.undo" | "format.bold",
  keybindingOverrides: KeybindingOverrides,
): boolean {
  return matchesCommandShortcut(event, command, keybindingOverrides, {
    editorFocused: true,
    fileTreeFocused: false,
    tableCellFocused: true,
    textInputFocused: true,
  });
}

function suppressesDefaultTableCellCommand(
  event: KeyboardEvent,
  command: "edit.redo" | "edit.undo" | "format.bold",
  keybindingOverrides: KeybindingOverrides,
): boolean {
  if (keybindingOverrides[command] === undefined || !hasPrimaryModifier(event) || event.altKey) {
    return false;
  }

  const key = event.key.toLowerCase();
  if (command === "edit.undo") {
    return key === "z" && !event.shiftKey;
  }
  if (command === "edit.redo") {
    return (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
  }
  return key === "b" && !event.shiftKey;
}

export function handleTableSelectionKeydown(
  event: KeyboardEvent,
  wrapper: HTMLElement,
  table: HTMLTableElement,
): void {
  if (event.target !== wrapper) return;
  if (event.isComposing || event.key === "Process") return;
  const state = readTableInteractionState(wrapper);
  const selection = state.selection;
  if (!selection || selection.kind !== "cell") return;

  if (event.key === "Escape") {
    event.preventDefault();
    clearTableSelection(wrapper);
    updateTableInteractionState(wrapper, { focusedCell: null, mode: "idle", selection: null });
    wrapper.blur();
    return;
  }

  const columnCount = table.tHead?.rows[0]?.cells.length ?? 0;
  const rowCount = table.rows.length;
  const current = state.focusedCell ?? selection.head;
  const next = nextTableCellPosition(event.key, current, rowCount, columnCount);
  if (!next) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const cell = wrapper.querySelector<HTMLElement>(
      `[data-table-row="${current.row}"][data-table-column="${current.column}"]`,
    );
    cell?.focus({ preventScroll: true });
    if (cell) placeCaretAtEnd(cell);
    return;
  }

  event.preventDefault();
  selectTableCell(wrapper, next, event.shiftKey);
}

function nextTableCellPosition(
  key: string,
  current: TableCellPosition,
  rowCount: number,
  columnCount: number,
): TableCellPosition | null {
  if (rowCount === 0 || columnCount === 0) return null;
  if (key === "ArrowLeft") return { row: current.row, column: Math.max(0, current.column - 1) };
  if (key === "ArrowRight") return { row: current.row, column: Math.min(columnCount - 1, current.column + 1) };
  if (key === "ArrowUp") return { row: Math.max(0, current.row - 1), column: current.column };
  if (key === "ArrowDown") return { row: Math.min(rowCount - 1, current.row + 1), column: current.column };
  if (key === "Home") return { row: current.row, column: 0 };
  if (key === "End") return { row: current.row, column: columnCount - 1 };
  return null;
}
