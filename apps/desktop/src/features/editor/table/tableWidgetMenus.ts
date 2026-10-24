import { translateCurrent } from "../../../shared/i18n/translate";
import { isTableRowLine } from "../markdown/liveMarkdownSyntax";
import { resizeMarkdownTable, tableColumnCount } from "../markdown/markdownTable";
import { TABLE_COMMANDS, type TableCommandId } from "../table/tableCommands";
import { TABLE_UI } from "../table/tableConstants";
import { updateTableInteractionState } from "../table/tableInteractionState";
import { closeTableMenus, registerTableMenu } from "../table/tableMenuLifecycle";
import { parseMarkdownTable } from "../table/tableModel";
import type { PreviewBlock } from "../markdown/previewBlocks";
import { applyTableOperation, applyTableCommand } from "./tableWidgetTransactions";

export function createTableToolbarButton(iconName: string, ariaLabel: string): HTMLButtonElement {
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

export function activeTableColumn(wrapper: HTMLElement): number {
  const activeColumn = Number.parseInt(wrapper.dataset.activeColumn ?? "0", 10);
  return Number.isFinite(activeColumn) ? activeColumn : 0;
}

export function openTableSizeMenu(
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

export function openTableActionMenu(
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
