import { EditorView, WidgetType } from "@codemirror/view";
import { translateCurrent } from "../../../shared/i18n/translate";
import type { KeybindingOverrides } from "../../../shared/settings/userSettings";
import { allowEditorVerticalScroll, markMarkdownPreviewBlock, scheduleEditorMeasureFromDom } from "../widgets/markdownBlockDom";
import { isTableRowLine } from "../markdown/liveMarkdownSyntax";
import { cssTextAlignForTableAlignment, parseTableAlignments, parseTableCells } from "../markdown/markdownTable";
import { TABLE_COMMANDS } from "../table/tableCommands";
import { installTableInteractionControls } from "../table/tableInteractionDom";
import { closeTableMenus } from "../table/tableMenuLifecycle";
import { readTableColumnWidths } from "../table/tableLayoutState";
import type { PreviewBlock } from "../markdown/previewBlocks";
import { makeTableCellEditable, handleTableSelectionKeydown } from "./tableCellEditing";
import { createTableToolbarButton, activeTableColumn, openTableSizeMenu } from "./tableWidgetMenus";
import { applyTableCommand } from "./tableWidgetTransactions";
import { writeTableSelectionToClipboard } from "./tableWidgetClipboard";
import { applyTableColumnWidths, autoFitTableColumn, resizeTableColumn } from "./tableColumnSizing";

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
