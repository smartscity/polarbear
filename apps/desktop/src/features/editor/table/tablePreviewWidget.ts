import { redo, undo } from "@codemirror/commands";
import { EditorSelection, Transaction, type StateEffect } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { translateCurrent } from "../../../shared/i18n/translate";
import { hasPrimaryModifier } from "../../../shared/platform/keyboard";
import type { KeybindingOverrides } from "../../../shared/settings/userSettings";
import { matchesCommandShortcut } from "../../../commands/keybindingResolver";
import { allowEditorVerticalScroll, markMarkdownPreviewBlock, scheduleEditorMeasureFromDom } from "../widgets/markdownBlockDom";
import { isTableRowLine } from "../markdown/liveMarkdownSyntax";
import { insertLineBreakAtCurrentSelection, markdownFromTableCellElement, placeCaretAtEnd, renderTableCellValue } from "../markdown/tableCellDom";
import { cssTextAlignForTableAlignment, parseTableAlignments, parseTableCells, resizeMarkdownTable, tableColumnCount, updateMarkdownTableCell } from "../markdown/markdownTable";
import { TABLE_COMMANDS, executeTableCommand, type TableCommandId } from "../table/tableCommands";
import { parseTableClipboard, pasteTableMatrix, tableSelectionAsMarkdown, tableSelectionAsTsvForSelection, tableSelectionPositions } from "../table/tableClipboard";
import { TABLE_UI } from "../table/tableConstants";
import { installTableInteractionControls, clearTableSelection, selectTableCell, setTableCellEditing } from "../table/tableInteractionDom";
import { readTableInteractionState, updateTableInteractionState } from "../table/tableInteractionState";
import { closeTableMenus, registerTableMenu } from "../table/tableMenuLifecycle";
import { readTableColumnWidths, tableWidthsEffect, tableWidthsForCommand } from "../table/tableLayoutState";
import { parseMarkdownTable } from "../table/tableModel";
import type { TableCellPosition, TableSelection } from "../table/tableTypes";
import type { PreviewBlock } from "../markdown/previewBlocks";

export class TablePreviewWidget extends WidgetType {
  private disposeInteraction: (() => void) | null = null;

  constructor(
    private readonly block: PreviewBlock,
    private readonly keybindingOverrides: KeybindingOverrides,
    private readonly documentId: string,
  ) {
    super();
  }

  eq(other: TablePreviewWidget): boolean {
    return (
      other.block.id === this.block.id
      && other.block.raw === this.block.raw
      && other.keybindingOverrides === this.keybindingOverrides
      && other.documentId === this.documentId
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-table-preview";
    wrapper.tabIndex = -1;
    markMarkdownPreviewBlock(wrapper, this.block, "markdown-table-block");
    wrapper.dataset.tableKey = String(this.block.from);
    wrapper.title = translateCurrent("diagram.tablePreview");
    allowEditorVerticalScroll(wrapper);

    const scrollport = document.createElement("div");
    scrollport.className = "cm-typora-table-scrollport";
    allowEditorVerticalScroll(scrollport);

    const lines = this.block.raw.split(/\r?\n/);
    const [headerLine, separatorLine = "", ...bodyLines] = lines;
    const headers = parseTableCells(headerLine ?? "");
    const alignments = parseTableAlignments(separatorLine, headers.length);
    const toolbar = document.createElement("div");
    toolbar.className = "cm-typora-table-toolbar";

    const leftTools = document.createElement("div");
    leftTools.className = "cm-typora-table-toolbar-left";

    const gridButton = createTableToolbarButton("grid", translateCurrent("table.size"));
    gridButton.classList.add("cm-typora-table-grid-button");
    gridButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTableSizeMenu(wrapper, this.block, gridButton);
    });

    const alignLeftButton = createTableToolbarButton("align-left", translateCurrent("table.alignment.left"));
    alignLeftButton.classList.add("cm-typora-table-align-left-button");
    alignLeftButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyTableCommand(wrapper, this.block, TABLE_COMMANDS.alignmentLeft, {
        row: 0,
        column: activeTableColumn(wrapper),
      });
    });

    const alignCenterButton = createTableToolbarButton("align-center", translateCurrent("table.alignment.center"));
    alignCenterButton.classList.add("cm-typora-table-align-center-button");
    alignCenterButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyTableCommand(wrapper, this.block, TABLE_COMMANDS.alignmentCenter, {
        row: 0,
        column: activeTableColumn(wrapper),
      });
    });

    const alignRightButton = createTableToolbarButton("align-right", translateCurrent("table.alignment.right"));
    alignRightButton.classList.add("cm-typora-table-align-right-button");
    alignRightButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyTableCommand(wrapper, this.block, TABLE_COMMANDS.alignmentRight, {
        row: 0,
        column: activeTableColumn(wrapper),
      });
    });

    leftTools.append(gridButton, alignLeftButton, alignCenterButton, alignRightButton);

    const deleteButton = createTableToolbarButton("delete", translateCurrent("table.delete"));
    deleteButton.className = "cm-typora-table-delete-button";
    deleteButton.setAttribute("aria-label", translateCurrent("table.delete"));
    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyTableCommand(wrapper, this.block, TABLE_COMMANDS.delete, { row: 0, column: 0 });
    });

    toolbar.append(leftTools, deleteButton);
    wrapper.append(toolbar);

    const table = document.createElement("table");
    table.dataset.tableKey = String(this.block.from);
    applyTableColumnWidths(table, readTableColumnWidths(view.state, this.block.from), headers.length);
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    let tableFocusIndex = 0;

    headers.forEach((header, columnIndex) => {
      const th = document.createElement("th");
      th.style.textAlign = cssTextAlignForTableAlignment(alignments[columnIndex] ?? "default");
      makeTableCellEditable(th, {
        block: this.block,
        columnIndex,
        focusIndex: tableFocusIndex,
        rowIndex: 0,
        sourceLineIndex: 0,
        value: header,
        wrapper,
        keybindingOverrides: this.keybindingOverrides,
      });
      tableFocusIndex += 1;
      headerRow.append(th);
    });

    thead.append(headerRow);
    table.append(thead);

    const tbody = document.createElement("tbody");
    bodyLines.forEach((bodyLine, bodyIndex) => {
      if (!isTableRowLine(bodyLine)) {
        return;
      }
      const row = document.createElement("tr");
      parseTableCells(bodyLine).forEach((cell, columnIndex) => {
        const td = document.createElement("td");
        td.style.textAlign = cssTextAlignForTableAlignment(alignments[columnIndex] ?? "default");
        makeTableCellEditable(td, {
          block: this.block,
          columnIndex,
          focusIndex: tableFocusIndex,
          rowIndex: bodyIndex + 1,
          sourceLineIndex: bodyIndex + 2,
          value: cell,
          wrapper,
          keybindingOverrides: this.keybindingOverrides,
        });
        tableFocusIndex += 1;
        row.append(td);
      });
      tbody.append(row);
    });
    table.append(tbody);
    scrollport.append(table);
    wrapper.append(scrollport);
    const disposeInteraction = installTableInteractionControls({
      columnCount: headers.length,
      onAutoFitColumn: (column) => autoFitTableColumn(table, this.block.from, column),
      onCommand: (command, position) => applyTableCommand(wrapper, this.block, command, position),
      onMoveColumn: (from, to) =>
        applyTableCommand(wrapper, this.block, TABLE_COMMANDS.columnMove, {
          row: 0,
          column: from,
        }, { targetColumn: to }),
      onMoveRow: (from, to) =>
        applyTableCommand(wrapper, this.block, TABLE_COMMANDS.rowMove, {
          row: from,
          column: 0,
        }, { targetRow: to }),
      onResizeColumn: (column, width) => {
        resizeTableColumn(view, table, this.block.from, column, width);
      },
      rowCount: bodyLines.filter(isTableRowLine).length + 1,
      scrollport,
      table,
      wrapper,
    });
    this.disposeInteraction = () => {
      closeTableMenus(wrapper);
      disposeInteraction();
    };
    wrapper.addEventListener("keydown", (event) => handleTableSelectionKeydown(event, wrapper, table));
    wrapper.addEventListener("copy", (event) => {
      writeTableSelectionToClipboard(event, wrapper, this.block.raw);
    });
    wrapper.addEventListener("cut", (event) => {
      if (!writeTableSelectionToClipboard(event, wrapper, this.block.raw)) return;
      applyTableCommand(wrapper, this.block, TABLE_COMMANDS.cellClear, { row: 0, column: 0 });
    });
    scheduleEditorMeasureFromDom(wrapper);

    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }

  destroy(): void {
    this.disposeInteraction?.();
    this.disposeInteraction = null;
  }
}

function makeTableCellEditable(
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
    const scrollDOM = view.scrollDOM;
    const scrollTop = scrollDOM.scrollTop;
    const scrollLeft = scrollDOM.scrollLeft;

    prepareTableHistorySelection(view, params.block.from);

    view.dispatch({
      changes: {
        from: params.block.from,
        to: params.block.to,
        insert: nextRaw,
      },
      scrollIntoView: false,
      userEvent: "input.tableCell",
    });

    scrollDOM.scrollTop = scrollTop;
    scrollDOM.scrollLeft = scrollLeft;
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
      if (commit()) {
        focusTableCellAfterCommit(params.wrapper, params.block.from, nextFocusIndex);
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

function handleTableSelectionKeydown(
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

function createTableToolbarButton(iconName: string, ariaLabel: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-typora-table-tool-button";
  button.title = ariaLabel;
  button.setAttribute("aria-label", ariaLabel);
  button.append(createTableIcon(iconName));
  return button;
}

function createTableIcon(iconName: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 18 18");
  svg.setAttribute("aria-hidden", "true");

  const addPath = (d: string) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  };

  if (iconName === "grid") {
    addPath("M3 3.5h4.5V8H3zM10.5 3.5H15V8h-4.5zM3 10h4.5v4.5H3zM10.5 10H15v4.5h-4.5z");
  } else if (iconName === "align-left") {
    addPath("M4 5h10M4 9h7M4 13h10");
  } else if (iconName === "align-center") {
    addPath("M4 5h10M5.5 9h7M4 13h10");
  } else if (iconName === "align-right") {
    addPath("M4 5h10M7 9h7M4 13h10");
  } else {
    addPath("M6.5 4.5V3h5v1.5M4.5 5.5h9M6 7v7M9 7v7M12 7v7");
  }

  return svg;
}

function applyTableColumnWidths(table: HTMLTableElement, widths: readonly number[], columnCount: number): void {
  const colgroup = table.querySelector("colgroup") ?? document.createElement("colgroup");
  if (!colgroup.parentElement) {
    table.prepend(colgroup);
  }

  colgroup.replaceChildren();
  for (let column = 0; column < columnCount; column += 1) {
    const col = document.createElement("col");
    const width = widths[column];
    if (width) {
      col.style.width = `${width}px`;
    }
    colgroup.append(col);
  }

  table.style.tableLayout = widths.some(Boolean) ? "fixed" : "auto";
}

function resizeTableColumn(view: EditorView, table: HTMLTableElement, from: number, column: number, width: number): void {
  const widths = readTableColumnWidths(view.state, from);
  widths[column] = width;
  view.dispatch({ effects: tableWidthsEffect(view.state, from, widths), annotations: Transaction.addToHistory.of(false) });
  applyTableColumnWidths(table, readTableColumnWidths(view.state, from), table.tHead?.rows[0]?.cells.length ?? 1);
}

function autoFitTableColumn(table: HTMLTableElement, from: number, column: number): void {
  const view = EditorView.findFromDOM(table.closest(".cm-typora-table-preview") ?? table);
  if (!view) return;
  const widths = Array.from(table.rows)
    .map((row) => row.cells[column])
    .filter((cell): cell is HTMLTableCellElement => Boolean(cell))
    .map((cell) => Math.max(cell.scrollWidth, cell.getBoundingClientRect().width));
  const width = Math.min(TABLE_UI.columnMaxWidthPx, Math.max(TABLE_UI.columnMinWidthPx, ...widths));
  resizeTableColumn(view, table, from, column, width);
}

function activeTableColumn(wrapper: HTMLElement): number {
  const activeColumn = Number.parseInt(wrapper.dataset.activeColumn ?? "0", 10);
  return Number.isFinite(activeColumn) ? activeColumn : 0;
}

function openTableSizeMenu(
  wrapper: HTMLElement,
  block: PreviewBlock,
  anchorElement: HTMLElement,
) {
  closeTableActionMenus(wrapper);
  updateTableInteractionState(wrapper, { mode: "contextMenuOpen" });

  const menu = document.createElement("div");
  menu.className = "cm-typora-table-size-menu";
  menu.setAttribute("role", "dialog");
  menu.tabIndex = -1;

  const grid = document.createElement("div");
  grid.className = "cm-typora-table-size-grid";
  const label = document.createElement("div");
  label.className = "cm-typora-table-size-label";

  const currentLines = block.raw.split(/\r?\n/);
  const currentRows = Math.max(1, currentLines.filter(isTableRowLine).length - 1);
  const currentColumns = tableColumnCount(currentLines);
  let selectedRows = currentRows;
  let selectedColumns = currentColumns;

  const updateGrid = (rows: number, columns: number) => {
    selectedRows = rows;
    selectedColumns = columns;
    label.textContent = translateCurrent("table.sizeValue", { columns, rows });
    for (const cell of grid.querySelectorAll<HTMLButtonElement>("button")) {
      const row = Number.parseInt(cell.dataset.row ?? "0", 10);
      const column = Number.parseInt(cell.dataset.column ?? "0", 10);
      cell.classList.toggle(
        "cm-typora-table-size-cell-active",
        row <= rows && column <= columns,
      );
    }
  };

  for (let row = 1; row <= 8; row += 1) {
    for (let column = 1; column <= 8; column += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.setAttribute(
        "aria-label",
        translateCurrent("table.sizeValue", { columns: column, rows: row }),
      );
      cell.addEventListener("mouseenter", () => updateGrid(row, column));
      cell.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeTableActionMenus(wrapper);
        applyTableOperation(wrapper, block, (lines) =>
          resizeMarkdownTable(lines, selectedRows, selectedColumns),
        );
      });
      grid.append(cell);
    }
  }

  updateGrid(selectedRows, selectedColumns);
  menu.append(grid, label);
  document.body.append(menu);

  const anchorRect = anchorElement.getBoundingClientRect();
  positionTablePortalMenu(menu, anchorRect.left, anchorRect.bottom + 4);

  const close = registerTableMenu(wrapper, menu, () => menu.focus({ preventScroll: true }));

  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    moveTableMenuFocus(menu, event);
  });

}

function openTableActionMenu(
  wrapper: HTMLElement,
  block: PreviewBlock,
  anchorElement: HTMLElement,
  position: {
    columnIndex: number;
    sourceLineIndex: number;
  },
  level: "advanced" | "primary" = "primary",
) {
  closeTableActionMenus(wrapper);
  updateTableInteractionState(wrapper, { mode: "contextMenuOpen" });

  const menu = document.createElement("div");
  menu.className = "cm-typora-table-menu";
  menu.setAttribute("role", "menu");
  menu.tabIndex = -1;

  const addAction = (
    label: string,
    action: () => void,
    disabled = false,
  ) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = disabled;
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      close(false);
      action();
    });
    menu.append(button);
  };

  const addSeparator = () => {
    const separator = document.createElement("span");
    separator.className = "cm-typora-table-menu-separator";
    menu.append(separator);
  };

  const row = position.sourceLineIndex === 0 ? 0 : position.sourceLineIndex - 1;
  const commandPosition = { row, column: position.columnIndex };
  const runCommand = (command: TableCommandId) =>
    applyTableCommand(wrapper, block, command, commandPosition);
  const table = parseMarkdownTable(block.raw);
  const bodyRowCount = table?.rows.length ?? 0;
  const columnCount = table?.header.length ?? 0;

  if (level === "primary") {
    addAction(translateCurrent("table.insert.rowBefore"), () =>
      applyTableCommand(wrapper, block, TABLE_COMMANDS.rowInsertBefore, {
        row: Math.max(1, row),
        column: position.columnIndex,
      }));
    addAction(translateCurrent("table.insert.rowAfter"), () =>
      applyTableCommand(wrapper, block, TABLE_COMMANDS.rowInsertAfter, {
        row: Math.max(1, row),
        column: position.columnIndex,
      }));
    addAction(translateCurrent("table.insert.columnBefore"), () => runCommand(TABLE_COMMANDS.columnInsertBefore));
    addAction(translateCurrent("table.insert.columnAfter"), () => runCommand(TABLE_COMMANDS.columnInsertAfter));
    addSeparator();
    addAction(translateCurrent("table.row.duplicate"), () => runCommand(TABLE_COMMANDS.rowDuplicate), row === 0);
    addAction(translateCurrent("table.column.duplicate"), () => runCommand(TABLE_COMMANDS.columnDuplicate));
    addAction(translateCurrent("table.more"), () =>
      openTableActionMenu(wrapper, block, anchorElement, position, "advanced"));
    addSeparator();
    addAction(translateCurrent("table.row.delete"), () => runCommand(TABLE_COMMANDS.rowDelete), row === 0);
    addAction(translateCurrent("table.column.delete"), () => runCommand(TABLE_COMMANDS.columnDelete));
  } else {
    addAction(translateCurrent("table.insert.rowsBefore"), () =>
      openTableInsertCountMenu(
        wrapper,
        anchorElement,
        translateCurrent("table.create.rows"),
        (count) => applyTableCommand(wrapper, block, TABLE_COMMANDS.rowInsertMultipleBefore, {
          row: Math.max(1, row),
          column: position.columnIndex,
        }, { count }),
      ));
    addAction(translateCurrent("table.insert.rowsAfter"), () =>
      openTableInsertCountMenu(
        wrapper,
        anchorElement,
        translateCurrent("table.create.rows"),
        (count) => applyTableCommand(wrapper, block, TABLE_COMMANDS.rowInsertMultipleAfter, {
          row: Math.max(1, row),
          column: position.columnIndex,
        }, { count }),
      ));
    addAction(translateCurrent("table.insert.columnsBefore"), () =>
      openTableInsertCountMenu(
        wrapper,
        anchorElement,
        translateCurrent("table.create.columns"),
        (count) => applyTableCommand(wrapper, block, TABLE_COMMANDS.columnInsertMultipleBefore, commandPosition, { count }),
      ));
    addAction(translateCurrent("table.insert.columnsAfter"), () =>
      openTableInsertCountMenu(
        wrapper,
        anchorElement,
        translateCurrent("table.create.columns"),
        (count) => applyTableCommand(wrapper, block, TABLE_COMMANDS.columnInsertMultipleAfter, commandPosition, { count }),
      ));
    addSeparator();
    addAction(translateCurrent("table.column.autoFit"), () => runCommand(TABLE_COMMANDS.columnAutoFit));
    addAction(translateCurrent("table.row.moveUp"), () => runCommand(TABLE_COMMANDS.rowMoveUp), row <= 1);
    addAction(translateCurrent("table.row.moveDown"), () => runCommand(TABLE_COMMANDS.rowMoveDown), row === 0 || row >= bodyRowCount);
    addAction(translateCurrent("table.column.moveLeft"), () => runCommand(TABLE_COMMANDS.columnMoveLeft), position.columnIndex <= 0);
    addAction(translateCurrent("table.column.moveRight"), () => runCommand(TABLE_COMMANDS.columnMoveRight), position.columnIndex >= columnCount - 1);
    addSeparator();
    addAction(translateCurrent("table.alignment.left"), () => runCommand(TABLE_COMMANDS.alignmentLeft));
    addAction(translateCurrent("table.alignment.center"), () => runCommand(TABLE_COMMANDS.alignmentCenter));
    addAction(translateCurrent("table.alignment.right"), () => runCommand(TABLE_COMMANDS.alignmentRight));
    addSeparator();
    addAction(translateCurrent("table.copyAsMarkdown"), () => {
      void navigator.clipboard?.writeText(block.raw);
    });
    addAction(translateCurrent("table.row.clear"), () => runCommand(TABLE_COMMANDS.rowClear));
    addAction(translateCurrent("table.column.clear"), () => runCommand(TABLE_COMMANDS.columnClear));
  }

  document.body.append(menu);

  const anchorRect = anchorElement.getBoundingClientRect();
  positionTablePortalMenu(menu, anchorRect.left, anchorRect.bottom + 4);

  const close = registerTableMenu(wrapper, menu,
    () => menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true }),
    () => { if (anchorElement.isConnected) anchorElement.focus({ preventScroll: true }); });

  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    moveTableMenuFocus(menu, event);
  });

}

function positionTablePortalMenu(menu: HTMLElement, left: number, top: number): void {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - menu.offsetWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - menu.offsetHeight - margin);
  menu.style.left = `${Math.min(Math.max(margin, left), maxLeft)}px`;
  menu.style.top = `${Math.min(Math.max(margin, top), maxTop)}px`;
}

function openTableInsertCountMenu(
  wrapper: HTMLElement,
  anchorElement: HTMLElement,
  kind: string,
  onConfirm: (count: number) => void,
): void {
  closeTableActionMenus(wrapper);
  updateTableInteractionState(wrapper, { mode: "contextMenuOpen" });

  const menu = document.createElement("form");
  menu.className = "cm-typora-table-count-menu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", translateCurrent("table.insert.countTitle", { kind }));

  const label = document.createElement("label");
  label.textContent = translateCurrent("table.insert.countLabel");
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = String(TABLE_UI.batchInsertMax);
  input.step = "1";
  input.value = "1";
  label.append(input);

  const actions = document.createElement("div");
  actions.className = "cm-typora-table-count-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = translateCurrent("common.cancel");
  const confirm = document.createElement("button");
  confirm.type = "submit";
  confirm.textContent = translateCurrent("common.insert");
  actions.append(cancel, confirm);
  menu.append(label, actions);
  document.body.append(menu);

  const anchorRect = anchorElement.getBoundingClientRect();
  positionTablePortalMenu(menu, anchorRect.left, anchorRect.bottom + 4);

  const close = registerTableMenu(wrapper, menu, () => {
    input.focus({ preventScroll: true });
    input.select();
  });

  cancel.addEventListener("click", () => close());
  menu.addEventListener("submit", (event) => {
    event.preventDefault();
    const count = Math.min(
      TABLE_UI.batchInsertMax,
      Math.max(1, Number.parseInt(input.value, 10) || 1),
    );
    close();
    onConfirm(count);
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
}

function closeTableActionMenus(wrapper: HTMLElement) {
  void wrapper;
  closeTableMenus();
}

function moveTableMenuFocus(menu: HTMLElement, event: KeyboardEvent): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  if (buttons.length === 0) return;
  event.preventDefault();
  const currentIndex = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? buttons.length - 1
      : event.key === "ArrowUp"
        ? (currentIndex - 1 + buttons.length) % buttons.length
        : (currentIndex + 1) % buttons.length;
  buttons[nextIndex]?.focus({ preventScroll: true });
}

function applyTableOperation(
  wrapper: HTMLElement,
  block: PreviewBlock,
  operation: (lines: string[]) => string[],
) {
  const nextRaw = operation(block.raw.split(/\r?\n/)).join("\n");
  applyTableEdit(wrapper, block, nextRaw);
}

function applyTableCommand(
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

function shouldCopyTableSelection(rawTable: string, selection: TableSelection): boolean {
  return tableSelectionPositions(rawTable, selection).length > 1;
}

function writeTableSelectionToClipboard(
  event: ClipboardEvent,
  wrapper: HTMLElement,
  rawTable: string,
): boolean {
  const selection = readTableInteractionState(wrapper).selection;
  if (!selection || !shouldCopyTableSelection(rawTable, selection)) return false;
  const tsv = tableSelectionAsTsvForSelection(rawTable, selection);
  const markdown = tableSelectionAsMarkdown(rawTable, selection);
  if (!tsv) return false;
  event.preventDefault();
  event.stopPropagation();
  event.clipboardData?.setData("text/plain", tsv);
  event.clipboardData?.setData("text/tab-separated-values", tsv);
  event.clipboardData?.setData("text/markdown", markdown);
  return true;
}

function applyTableEdit(
  wrapper: HTMLElement,
  block: PreviewBlock,
  nextRaw: string,
  focus?: TableCellPosition,
  effects?: StateEffect<unknown>[],
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
    userEvent: "input.table",
    effects,
  });
  scrollDOM.scrollTop = scrollTop;
  scrollDOM.scrollLeft = scrollLeft;

  if (focus) {
    focusTableCellAtAfterCommit(wrapper, block.from, focus);
  }
}

function runTableHistoryAction(
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
  const restore = () => {
    restoreTableHistoryScrollPosition(view, scrollTop, scrollLeft);

    if (!tableKey) return true;
    const nextWrapper = findTablePreviewWrapper(tableKey);
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

function prepareTableHistorySelection(view: EditorView, position: number): void {
  if (view.state.selection.main.head === position) {
    return;
  }

  view.dispatch({
    selection: EditorSelection.cursor(position),
    scrollIntoView: false,
    annotations: Transaction.addToHistory.of(false),
  });
}

function findTablePreviewWrapper(tableKey: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(".cm-typora-table-preview")).find(
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
  wrapper: HTMLElement,
  blockFrom: number,
  position: TableCellPosition,
) {
  const focusCell = (): boolean => {
    const nextWrapper = document.querySelector<HTMLElement>(
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

function focusTableCellAfterCommit(
  wrapper: HTMLElement,
  blockFrom: number,
  focusIndex: number,
) {
  if (focusIndex < 0) {
    return;
  }

  const focusCell = (): boolean => {
    const nextWrapper = document.querySelector<HTMLElement>(
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
