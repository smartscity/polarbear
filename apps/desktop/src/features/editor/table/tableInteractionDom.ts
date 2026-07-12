import { TABLE_UI } from "./tableConstants";
import { translateCurrent } from "../../../shared/i18n/translate";
import { EditorView } from "@codemirror/view";
import {
  clearTableInteractionState,
  readTableInteractionState,
  updateTableInteractionState,
} from "./tableInteractionState";
import type { TableCommandId } from "./tableCommands";
import type { TableCellPosition, TableInteractionState, TableSelection } from "./tableTypes";

type TableInteractionControlsOptions = {
  columnCount: number;
  onAutoFitColumn: (column: number) => void;
  onCommand: (command: TableCommandId, position: TableCellPosition) => void;
  onMoveColumn: (from: number, to: number) => void;
  onMoveRow: (from: number, to: number) => void;
  onResizeColumn: (column: number, width: number) => void;
  rowCount: number;
  scrollport: HTMLElement;
  table: HTMLTableElement;
  wrapper: HTMLElement;
};

type DragState =
  | { kind: "column"; pointerId: number; source: number; target: number }
  | { kind: "row"; pointerId: number; source: number; target: number }
  | null;

type CellRangeDragState = {
  anchor: TableCellPosition;
  active: boolean;
  pointerId: number;
} | null;

const activeSelectionByTable = new WeakMap<HTMLElement, TableSelection>();

export function installTableInteractionControls(options: TableInteractionControlsOptions): () => void {
  const overlay = document.createElement("div");
  overlay.className = "cm-typora-table-interaction-overlay";

  const tableHandle = createOverlayButton("cm-typora-table-handle", "▦", translateCurrent("table.selectTable"));
  const columnGapButton = createOverlayButton("cm-typora-table-gap-button cm-typora-table-gap-column", "+", translateCurrent("table.addColumn"));
  const rowGapButton = createOverlayButton("cm-typora-table-gap-button cm-typora-table-gap-row", "+", translateCurrent("table.addRow"));
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "cm-typora-table-resize-handle";
  const dropIndicator = document.createElement("div");
  dropIndicator.className = "cm-typora-table-drop-indicator";

  overlay.append(tableHandle, columnGapButton, rowGapButton, resizeHandle, dropIndicator);
  options.wrapper.append(overlay);
  updateTableInteractionState(options.wrapper, { activeTableId: options.wrapper.dataset.tableKey ?? null });

  const rowHandles = Array.from({ length: options.rowCount }, (_, row) => {
    const handle = createDragHandle("cm-typora-table-row-handle", "vertical", translateCurrent("table.row.handle"));
    handle.dataset.row = String(row);
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectTableRows(options.wrapper, [row], event.shiftKey);
    });
    handle.addEventListener("pointerdown", (event) => beginDrag(event, "row", row));
    overlay.append(handle);
    return handle;
  });

  const columnHandles = Array.from({ length: options.columnCount }, (_, column) => {
    const handle = createDragHandle("cm-typora-table-column-handle", "horizontal", translateCurrent("table.column.handle"));
    handle.dataset.column = String(column);
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectTableColumns(options.wrapper, [column], event.shiftKey);
    });
    handle.addEventListener("pointerdown", (event) => beginDrag(event, "column", column));
    overlay.append(handle);
    return handle;
  });

  let activeColumnBoundary: number | null = null;
  let activeRowBoundary: number | null = null;
  let activeResizeColumn: number | null = null;
  let cellRangeDrag: CellRangeDragState = null;
  let dragState: DragState = null;
  let resizeState: { column: number; pointerId: number; startWidth: number; startX: number } | null = null;
  let layoutFrame = 0;

  tableHandle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectWholeTable(options.wrapper);
  });

  columnGapButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (activeColumnBoundary !== null) {
      options.onCommand("table.column.insertBefore", { row: 0, column: activeColumnBoundary });
    }
  });
  columnGapButton.addEventListener("pointermove", (event) => event.stopPropagation());

  rowGapButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (activeRowBoundary !== null) {
      options.onCommand("table.row.insertBefore", { row: activeRowBoundary, column: 0 });
    }
  });
  rowGapButton.addEventListener("pointermove", (event) => event.stopPropagation());

  resizeHandle.addEventListener("pointerdown", (event) => {
    if (activeResizeColumn === null) return;
    const cell = headerCells(options.table)[activeResizeColumn];
    if (!cell) return;
    event.preventDefault();
    event.stopPropagation();
    resizeState = {
      column: activeResizeColumn,
      pointerId: event.pointerId,
      startWidth: cell.getBoundingClientRect().width,
      startX: event.clientX,
    };
    resizeHandle.setPointerCapture(event.pointerId);
    options.wrapper.dataset.tableResizing = "true";
  });

  resizeHandle.addEventListener("dblclick", (event) => {
    if (activeResizeColumn === null) return;
    event.preventDefault();
    options.onAutoFitColumn(activeResizeColumn);
  });

  function beginDrag(event: PointerEvent, kind: "column" | "row", source: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragState = { kind, pointerId: event.pointerId, source, target: source };
    updateTableInteractionState(options.wrapper, {
      draggingColumn: kind === "column" ? source : null,
      draggingRow: kind === "row" ? source : null,
      hoveredColumnBoundary: null,
      hoveredRowBoundary: null,
      mode: kind === "column" ? "draggingColumn" : "draggingRow",
    });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    options.wrapper.dataset.tableDragging = kind;
    hideTransientControls();
  }

  function beginCellRangeSelection(event: PointerEvent): void {
    if (event.button !== 0 || dragState || resizeState || event.shiftKey) return;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-table-row][data-table-column]")
      : null;
    if (!target || !options.wrapper.contains(target)) return;
    const row = Number(target.dataset.tableRow);
    const column = Number(target.dataset.tableColumn);
    if (!Number.isInteger(row) || !Number.isInteger(column)) return;
    cellRangeDrag = { anchor: { row, column }, active: false, pointerId: event.pointerId };
  }

  function updateCellRangeSelection(event: PointerEvent): void {
    if (!cellRangeDrag || event.pointerId !== cellRangeDrag.pointerId || dragState || resizeState) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const cell = target instanceof Element
      ? target.closest<HTMLElement>("[data-table-row][data-table-column]")
      : null;
    if (!cell || !options.wrapper.contains(cell)) return;
    const row = Number(cell.dataset.tableRow);
    const column = Number(cell.dataset.tableColumn);
    if (!Number.isInteger(row) || !Number.isInteger(column)) return;
    if (row === cellRangeDrag.anchor.row && column === cellRangeDrag.anchor.column) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    if (!cellRangeDrag.active) {
      options.wrapper.setPointerCapture(event.pointerId);
      cellRangeDrag.active = true;
      hideTransientControls();
    }
    selectTableCellRange(options.wrapper, cellRangeDrag.anchor, { row, column });
  }

  function endCellRangeSelection(event: PointerEvent): void {
    if (!cellRangeDrag || event.pointerId !== cellRangeDrag.pointerId) return;
    const completed = cellRangeDrag;
    cellRangeDrag = null;
    if (!completed.active) return;
    event.preventDefault();
    options.wrapper.focus({ preventScroll: true });
    options.wrapper.dataset.suppressTableCellClick = "true";
  }

  function suppressClickAfterRangeSelection(event: MouseEvent): void {
    if (options.wrapper.dataset.suppressTableCellClick !== "true") return;
    delete options.wrapper.dataset.suppressTableCellClick;
    event.preventDefault();
    event.stopPropagation();
  }

  function scheduleLayout(): void {
    if (layoutFrame) return;
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = 0;
      layoutControls();
    });
  }

  function layoutControls(): void {
    const wrapperRect = options.wrapper.getBoundingClientRect();
    const tableRect = options.table.getBoundingClientRect();
    const scrollLeft = options.scrollport.scrollLeft;
    const scrollTop = options.scrollport.scrollTop;
    const left = tableRect.left - wrapperRect.left + scrollLeft;
    const top = tableRect.top - wrapperRect.top + scrollTop;

    tableHandle.style.transform = `translate(${left - 24}px, ${top - 24}px)`;

    Array.from(options.table.rows).forEach((row, index) => {
      const handle = rowHandles[index];
      if (!handle) return;
      const rect = row.getBoundingClientRect();
      handle.style.transform = `translate(${rect.left - wrapperRect.left + scrollLeft - 20}px, ${rect.top - wrapperRect.top + scrollTop + (rect.height - 16) / 2}px)`;
    });

    headerCells(options.table).forEach((cell, index) => {
      const handle = columnHandles[index];
      if (!handle) return;
      const rect = cell.getBoundingClientRect();
      handle.style.transform = `translate(${rect.left - wrapperRect.left + scrollLeft + (rect.width - 16) / 2}px, ${top + 3}px)`;
    });
  }

  function hideTransientControls(): void {
    activeColumnBoundary = null;
    activeRowBoundary = null;
    activeResizeColumn = null;
    columnGapButton.hidden = true;
    rowGapButton.hidden = true;
    resizeHandle.hidden = true;
    rowHandles.forEach((handle) => handle.classList.remove("cm-typora-table-handle-active"));
    columnHandles.forEach((handle) => handle.classList.remove("cm-typora-table-handle-active"));
    updateTableInteractionState(options.wrapper, {
      hoveredColumnBoundary: null,
      hoveredRowBoundary: null,
      mode: "idle",
      resizingColumn: null,
    });
  }

  function updatePointerControls(event: PointerEvent): void {
    if (cellRangeDrag?.active || dragState || resizeState) return;
    updateActiveDragHandles(event);
    const tableRect = options.table.getBoundingClientRect();
    const wrapperRect = options.wrapper.getBoundingClientRect();
    if (
      event.clientX < tableRect.left - TABLE_UI.boundaryHitAreaPx ||
      event.clientX > tableRect.right + TABLE_UI.boundaryHitAreaPx ||
      event.clientY < tableRect.top - TABLE_UI.boundaryHitAreaPx ||
      event.clientY > tableRect.bottom + TABLE_UI.boundaryHitAreaPx
    ) {
      hideTransientControls();
      return;
    }

    const columns = headerCells(options.table);
    const rows = Array.from(options.table.rows);
    const columnBoundary = nearestColumnBoundary(columns, event.clientX);
    const rowBoundary = nearestRowBoundary(rows, event.clientY);
    const columnDistance = columnBoundary?.distance ?? Number.POSITIVE_INFINITY;
    const rowDistance = rowBoundary?.distance ?? Number.POSITIVE_INFINITY;
    const scrollLeft = options.scrollport.scrollLeft;
    const scrollTop = options.scrollport.scrollTop;
    const inColumnInsertZone =
      event.clientY >= tableRect.top - TABLE_UI.boundaryHitAreaPx &&
      event.clientY <= tableRect.top + TABLE_UI.gapButtonSizePx + TABLE_UI.boundaryHitAreaPx;
    const inRowInsertZone =
      event.clientX >= tableRect.left - TABLE_UI.boundaryHitAreaPx &&
      event.clientX <= tableRect.left + TABLE_UI.gapButtonSizePx + TABLE_UI.boundaryHitAreaPx;

    activeResizeColumn = !inColumnInsertZone && columnBoundary && columnBoundary.boundary > 0 && columnBoundary.boundary < columns.length
      ? columnBoundary.boundary - 1
      : null;
    if (activeResizeColumn !== null && columnDistance <= TABLE_UI.boundaryHitAreaPx) {
      resizeHandle.hidden = false;
      resizeHandle.style.transform = `translate(${columnBoundary!.coordinate - wrapperRect.left + scrollLeft - 3}px, ${tableRect.top - wrapperRect.top + scrollTop + TABLE_UI.gapButtonSizePx + 4}px)`;
      resizeHandle.style.height = `${Math.max(0, tableRect.height - TABLE_UI.gapButtonSizePx - 4)}px`;
    } else {
      resizeHandle.hidden = true;
    }
    updateTableInteractionState(options.wrapper, {
      hoveredColumnBoundary: activeColumnBoundary,
      hoveredRowBoundary: activeRowBoundary,
      mode: activeResizeColumn === null ? "hovering" : "resizingColumn",
      resizingColumn: activeResizeColumn,
    });

    if (columnBoundary && inColumnInsertZone && columnDistance <= TABLE_UI.boundaryHitAreaPx) {
      activeColumnBoundary = columnBoundary.boundary;
      activeRowBoundary = null;
      columnGapButton.hidden = false;
      rowGapButton.hidden = true;
      columnGapButton.style.transform = `translate(${columnBoundary.coordinate - wrapperRect.left + scrollLeft - TABLE_UI.gapButtonSizePx / 2}px, ${tableRect.top - wrapperRect.top + scrollTop + 4}px)`;
      updateTableInteractionState(options.wrapper, {
        hoveredColumnBoundary: activeColumnBoundary,
        hoveredRowBoundary: null,
        mode: "hovering",
      });
      return;
    }

    if (rowBoundary && inRowInsertZone && rowDistance <= TABLE_UI.boundaryHitAreaPx) {
      activeRowBoundary = rowBoundary.boundary;
      activeColumnBoundary = null;
      rowGapButton.hidden = false;
      columnGapButton.hidden = true;
      rowGapButton.style.transform = `translate(${tableRect.left - wrapperRect.left + scrollLeft + 4}px, ${rowBoundary.coordinate - wrapperRect.top + scrollTop - TABLE_UI.gapButtonSizePx / 2}px)`;
      updateTableInteractionState(options.wrapper, {
        hoveredColumnBoundary: null,
        hoveredRowBoundary: activeRowBoundary,
        mode: "hovering",
      });
      return;
    }

    activeColumnBoundary = null;
    activeRowBoundary = null;
    columnGapButton.hidden = true;
    rowGapButton.hidden = true;
    updateTableInteractionState(options.wrapper, {
      hoveredColumnBoundary: null,
      hoveredRowBoundary: null,
      mode: "idle",
    });
  }

  function updateActiveDragHandles(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const rowHandle = target?.closest<HTMLButtonElement>(".cm-typora-table-row-handle");
    const columnHandle = target?.closest<HTMLButtonElement>(".cm-typora-table-column-handle");
    const cell = target?.closest<HTMLElement>("[data-table-row][data-table-column]");
    const row = rowHandle?.dataset.row ?? cell?.dataset.tableRow ?? null;
    const column = columnHandle?.dataset.column ?? cell?.dataset.tableColumn ?? null;
    rowHandles.forEach((handle) => handle.classList.toggle("cm-typora-table-handle-active", handle.dataset.row === row));
    columnHandles.forEach((handle) => handle.classList.toggle("cm-typora-table-handle-active", handle.dataset.column === column));
  }

  function updateResize(event: PointerEvent): void {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;
    const width = Math.min(
      TABLE_UI.columnMaxWidthPx,
      Math.max(TABLE_UI.columnMinWidthPx, resizeState.startWidth + event.clientX - resizeState.startX),
    );
    options.onResizeColumn(resizeState.column, width);
    scheduleLayout();
  }

  function updateDrag(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const target = dragState.kind === "row"
      ? nearestRowIndex(Array.from(options.table.rows), event.clientY)
      : nearestColumnIndex(headerCells(options.table), event.clientX);
    if (target === null) return;
    dragState.target = target;
    const wrapperRect = options.wrapper.getBoundingClientRect();
    const targetRect = dragState.kind === "row"
      ? options.table.rows[target]?.getBoundingClientRect()
      : headerCells(options.table)[target]?.getBoundingClientRect();
    if (!targetRect) return;
    autoScrollDuringDrag(event);
    dropIndicator.hidden = false;
    dropIndicator.className = `cm-typora-table-drop-indicator cm-typora-table-drop-indicator-${dragState.kind}`;
    if (dragState.kind === "row") {
      dropIndicator.style.transform = `translate(${targetRect.left - wrapperRect.left + options.scrollport.scrollLeft}px, ${targetRect.top - wrapperRect.top + options.scrollport.scrollTop}px)`;
      dropIndicator.style.width = `${targetRect.width}px`;
      dropIndicator.style.height = "2px";
    } else {
      dropIndicator.style.transform = `translate(${targetRect.left - wrapperRect.left + options.scrollport.scrollLeft}px, ${targetRect.top - wrapperRect.top + options.scrollport.scrollTop}px)`;
      dropIndicator.style.width = "2px";
      dropIndicator.style.height = `${options.table.getBoundingClientRect().height}px`;
    }
  }

  function autoScrollDuringDrag(event: PointerEvent): void {
    const editor = EditorView.findFromDOM(options.wrapper);
    const editorScrollport = editor?.scrollDOM;
    if (editorScrollport) {
      const rect = editorScrollport.getBoundingClientRect();
      if (event.clientY < rect.top + TABLE_UI.edgeAutoScrollAreaPx) {
        editorScrollport.scrollTop -= TABLE_UI.edgeAutoScrollStepPx;
      } else if (event.clientY > rect.bottom - TABLE_UI.edgeAutoScrollAreaPx) {
        editorScrollport.scrollTop += TABLE_UI.edgeAutoScrollStepPx;
      }
    }

    const tableScrollportRect = options.scrollport.getBoundingClientRect();
    if (event.clientX < tableScrollportRect.left + TABLE_UI.edgeAutoScrollAreaPx) {
      options.scrollport.scrollLeft -= TABLE_UI.edgeAutoScrollStepPx;
    } else if (event.clientX > tableScrollportRect.right - TABLE_UI.edgeAutoScrollAreaPx) {
      options.scrollport.scrollLeft += TABLE_UI.edgeAutoScrollStepPx;
    }
  }

  function endPointer(event: PointerEvent): void {
    if (resizeState && event.pointerId === resizeState.pointerId) {
    resizeState = null;
    delete options.wrapper.dataset.tableResizing;
    updateTableInteractionState(options.wrapper, { mode: "idle", resizingColumn: null });
    }
    if (dragState && event.pointerId === dragState.pointerId) {
      const completed = dragState;
      dragState = null;
      delete options.wrapper.dataset.tableDragging;
      dropIndicator.hidden = true;
      updateTableInteractionState(options.wrapper, { mode: "idle", draggingColumn: null, draggingRow: null });
      if (completed.source !== completed.target) {
        if (completed.kind === "row" && completed.source > 0 && completed.target > 0) {
          options.onMoveRow(completed.source, completed.target);
        }
        if (completed.kind === "column") {
          options.onMoveColumn(completed.source, completed.target);
        }
      }
    }
  }

  function cancelDrag(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !dragState) return;
    event.preventDefault();
    dragState = null;
    delete options.wrapper.dataset.tableDragging;
    dropIndicator.hidden = true;
    updateTableInteractionState(options.wrapper, { mode: "idle", draggingColumn: null, draggingRow: null });
  }

  options.wrapper.addEventListener("pointermove", updatePointerControls);
  options.wrapper.addEventListener("pointerdown", beginCellRangeSelection, true);
  options.wrapper.addEventListener("pointermove", updateCellRangeSelection);
  options.wrapper.addEventListener("pointerup", endCellRangeSelection);
  options.wrapper.addEventListener("pointercancel", endCellRangeSelection);
  options.wrapper.addEventListener("click", suppressClickAfterRangeSelection, true);
  options.scrollport.addEventListener("scroll", scheduleLayout, { passive: true });
  window.addEventListener("pointermove", updateResize);
  window.addEventListener("pointermove", updateDrag);
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);
  window.addEventListener("keydown", cancelDrag);
  window.requestAnimationFrame(layoutControls);

  return () => {
    if (layoutFrame) {
      window.cancelAnimationFrame(layoutFrame);
    }
    options.wrapper.removeEventListener("pointermove", updatePointerControls);
    options.wrapper.removeEventListener("pointerdown", beginCellRangeSelection, true);
    options.wrapper.removeEventListener("pointermove", updateCellRangeSelection);
    options.wrapper.removeEventListener("pointerup", endCellRangeSelection);
    options.wrapper.removeEventListener("pointercancel", endCellRangeSelection);
    options.wrapper.removeEventListener("click", suppressClickAfterRangeSelection, true);
    options.scrollport.removeEventListener("scroll", scheduleLayout);
    window.removeEventListener("pointermove", updateResize);
    window.removeEventListener("pointermove", updateDrag);
    window.removeEventListener("pointerup", endPointer);
    window.removeEventListener("pointercancel", endPointer);
    window.removeEventListener("keydown", cancelDrag);
    clearTableInteractionState(options.wrapper);
    overlay.remove();
  };
}

export function selectTableCell(
  wrapper: HTMLElement,
  position: TableCellPosition,
  extend: boolean,
): void {
  const current = activeSelectionByTable.get(wrapper);
  const anchor = extend && current?.kind === "cell" ? current.anchor : position;
  applyTableSelection(wrapper, { kind: "cell", anchor, head: position });
  updateTableInteractionState(wrapper, {
    focusedCell: position,
    mode: extend ? "rangeSelected" : "cellSelected",
    selection: { kind: "cell", anchor, head: position },
  });
}

export function selectTableCellRange(
  wrapper: HTMLElement,
  anchor: TableCellPosition,
  head: TableCellPosition,
): void {
  const selection: TableSelection = { kind: "cell", anchor, head };
  applyTableSelection(wrapper, selection);
  updateTableInteractionState(wrapper, {
    focusedCell: head,
    mode: anchor.row === head.row && anchor.column === head.column ? "cellSelected" : "rangeSelected",
    selection,
  });
}

export function selectTableRows(wrapper: HTMLElement, rows: number[], extend = false): void {
  const current = activeSelectionByTable.get(wrapper);
  const selection = extend && current?.kind === "row"
    ? { kind: "row" as const, rows: inclusiveRange(current.rows[0] ?? rows[0] ?? 0, rows[0] ?? 0) }
    : { kind: "row" as const, rows };
  applyTableSelection(wrapper, selection);
  updateTableInteractionState(wrapper, { mode: "rowSelected", selection });
}

export function selectTableColumns(wrapper: HTMLElement, columns: number[], extend = false): void {
  const current = activeSelectionByTable.get(wrapper);
  const selection = extend && current?.kind === "column"
    ? { kind: "column" as const, columns: inclusiveRange(current.columns[0] ?? columns[0] ?? 0, columns[0] ?? 0) }
    : { kind: "column" as const, columns };
  applyTableSelection(wrapper, selection);
  updateTableInteractionState(wrapper, { mode: "columnSelected", selection });
}

export function selectWholeTable(wrapper: HTMLElement): void {
  applyTableSelection(wrapper, { kind: "table" });
  updateTableInteractionState(wrapper, { mode: "tableSelected", selection: { kind: "table" } });
}

export function clearTableSelection(wrapper: HTMLElement): void {
  activeSelectionByTable.delete(wrapper);
  for (const cell of wrapper.querySelectorAll("[data-table-row][data-table-column]")) {
    cell.classList.remove("cm-typora-table-cell-selected");
  }
  wrapper.classList.remove("cm-typora-table-selected");
}

export function setTableCellEditing(
  wrapper: HTMLElement,
  position: TableCellPosition | null,
): void {
  const state = readTableInteractionState(wrapper);
  updateTableInteractionState(wrapper, {
    focusedCell: position,
    mode: position ? "cellEditing" : selectionMode(state.selection),
  });
}

function applyTableSelection(wrapper: HTMLElement, selection: TableSelection): void {
  activeSelectionByTable.set(wrapper, selection);
  const cells = wrapper.querySelectorAll<HTMLElement>("[data-table-row][data-table-column]");
  for (const cell of cells) {
    const row = Number(cell.dataset.tableRow);
    const column = Number(cell.dataset.tableColumn);
    cell.classList.toggle("cm-typora-table-cell-selected", selectionIncludes(selection, row, column));
  }
  wrapper.classList.toggle("cm-typora-table-selected", selection.kind === "table");
}

function selectionIncludes(selection: TableSelection, row: number, column: number): boolean {
  if (selection.kind === "table") return true;
  if (selection.kind === "row") return selection.rows.includes(row);
  if (selection.kind === "column") return selection.columns.includes(column);
  const minRow = Math.min(selection.anchor.row, selection.head.row);
  const maxRow = Math.max(selection.anchor.row, selection.head.row);
  const minColumn = Math.min(selection.anchor.column, selection.head.column);
  const maxColumn = Math.max(selection.anchor.column, selection.head.column);
  return row >= minRow && row <= maxRow && column >= minColumn && column <= maxColumn;
}

function inclusiveRange(from: number, to: number): number[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function selectionMode(selection: TableSelection | null): TableInteractionState["mode"] {
  if (!selection) return "idle";
  if (selection.kind === "table") return "tableSelected";
  if (selection.kind === "row") return "rowSelected";
  if (selection.kind === "column") return "columnSelected";
  return selection.anchor.row === selection.head.row && selection.anchor.column === selection.head.column
    ? "cellSelected"
    : "rangeSelected";
}

function createOverlayButton(className: string, glyph: string, ariaLabel: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = glyph;
  button.setAttribute("aria-label", ariaLabel);
  button.title = ariaLabel;
  button.tabIndex = -1;
  return button;
}

function createDragHandle(
  className: string,
  orientation: "horizontal" | "vertical",
  ariaLabel: string,
): HTMLButtonElement {
  const handle = createOverlayButton(className, "", ariaLabel);
  handle.append(createGripIcon(orientation));
  return handle;
}

function createGripIcon(orientation: "horizontal" | "vertical"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("cm-typora-table-drag-grip");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const points = orientation === "vertical"
    ? [[5, 3], [11, 3], [5, 8], [11, 8], [5, 13], [11, 13]]
    : [[3, 5], [8, 5], [13, 5], [3, 11], [8, 11], [13, 11]];
  points.forEach(([cx, cy]) => {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", "1.35");
    svg.append(dot);
  });
  return svg;
}

function headerCells(table: HTMLTableElement): HTMLTableCellElement[] {
  return Array.from(table.tHead?.rows[0]?.cells ?? []);
}

function nearestColumnBoundary(cells: HTMLTableCellElement[], x: number): { boundary: number; coordinate: number; distance: number } | null {
  if (cells.length === 0) return null;
  const boundaries = [
    cells[0]?.getBoundingClientRect().left,
    ...cells.map((cell) => cell.getBoundingClientRect().right),
  ].filter((coordinate): coordinate is number => typeof coordinate === "number");
  return nearestBoundary(boundaries, x);
}

function nearestRowBoundary(rows: HTMLTableRowElement[], y: number): { boundary: number; coordinate: number; distance: number } | null {
  if (rows.length === 0) return null;
  const boundaries = [
    rows[0]?.getBoundingClientRect().top,
    ...rows.map((row) => row.getBoundingClientRect().bottom),
  ].filter((coordinate): coordinate is number => typeof coordinate === "number");
  const result = nearestBoundary(boundaries, y);
  if (!result) return null;
  // A Markdown table only has one header, so every boundary inserts a body row.
  return { ...result, boundary: Math.max(1, result.boundary) };
}

function nearestBoundary(boundaries: number[], coordinate: number): { boundary: number; coordinate: number; distance: number } | null {
  let result: { boundary: number; coordinate: number; distance: number } | null = null;
  boundaries.forEach((boundaryCoordinate, boundary) => {
    const distance = Math.abs(boundaryCoordinate - coordinate);
    if (!result || distance < result.distance) {
      result = { boundary, coordinate: boundaryCoordinate, distance };
    }
  });
  return result;
}

function nearestRowIndex(rows: HTMLTableRowElement[], y: number): number | null {
  if (rows.length === 0) return null;
  let target = 0;
  let distance = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    const rect = row.getBoundingClientRect();
    const nextDistance = Math.abs(rect.top + rect.height / 2 - y);
    if (nextDistance < distance) {
      distance = nextDistance;
      target = index;
    }
  });
  return target;
}

function nearestColumnIndex(cells: HTMLTableCellElement[], x: number): number | null {
  if (cells.length === 0) return null;
  let target = 0;
  let distance = Number.POSITIVE_INFINITY;
  cells.forEach((cell, index) => {
    const rect = cell.getBoundingClientRect();
    const nextDistance = Math.abs(rect.left + rect.width / 2 - x);
    if (nextDistance < distance) {
      distance = nextDistance;
      target = index;
    }
  });
  return target;
}
