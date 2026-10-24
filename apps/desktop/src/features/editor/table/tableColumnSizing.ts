import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { TABLE_UI } from "../table/tableConstants";
import { readTableColumnWidths, tableWidthsEffect } from "../table/tableLayoutState";


export function applyTableColumnWidths(table: HTMLTableElement, widths: readonly number[], columnCount: number): void {
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

export function resizeTableColumn(view: EditorView, table: HTMLTableElement, from: number, column: number, width: number): void {
  const widths = readTableColumnWidths(view.state, from);
  widths[column] = width;
  view.dispatch({ effects: tableWidthsEffect(view.state, from, widths), annotations: Transaction.addToHistory.of(false) });
  applyTableColumnWidths(table, readTableColumnWidths(view.state, from), table.tHead?.rows[0]?.cells.length ?? 1);
}

export function autoFitTableColumn(table: HTMLTableElement, from: number, column: number): void {
  const view = EditorView.findFromDOM(table.closest(".cm-typora-table-preview") ?? table);
  if (!view) return;
  const widths = Array.from(table.rows)
    .map((row) => row.cells[column])
    .filter((cell): cell is HTMLTableCellElement => Boolean(cell))
    .map((cell) => Math.max(cell.scrollWidth, cell.getBoundingClientRect().width));
  const width = Math.min(TABLE_UI.columnMaxWidthPx, Math.max(TABLE_UI.columnMinWidthPx, ...widths));
  resizeTableColumn(view, table, from, column, width);
}
