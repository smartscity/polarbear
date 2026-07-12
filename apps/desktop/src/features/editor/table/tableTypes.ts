export type TableAlignment = "center" | "default" | "left" | "right";

export type TableCellPosition = {
  column: number;
  row: number;
};

export type TableSelection =
  | {
      kind: "cell";
      anchor: TableCellPosition;
      head: TableCellPosition;
    }
  | {
      kind: "column";
      columns: number[];
    }
  | {
      kind: "row";
      rows: number[];
    }
  | {
      kind: "table";
    };

export type TableInteractionMode =
  | "cellEditing"
  | "cellFocused"
  | "cellSelected"
  | "columnSelected"
  | "contextMenuOpen"
  | "draggingColumn"
  | "draggingRow"
  | "hovering"
  | "idle"
  | "rangeSelected"
  | "resizingColumn"
  | "rowSelected"
  | "tableSelected";

export type TableInteractionState = {
  activeTableId: string | null;
  focusedCell: TableCellPosition | null;
  hoveredColumnBoundary: number | null;
  hoveredRowBoundary: number | null;
  mode: TableInteractionMode;
  resizingColumn: number | null;
  draggingColumn: number | null;
  draggingRow: number | null;
  selection: TableSelection | null;
};

export type MarkdownTable = {
  alignments: TableAlignment[];
  header: string[];
  rows: string[][];
};

export type TableEditTarget = {
  column: number;
  row: number;
};

export const EMPTY_TABLE_INTERACTION_STATE: TableInteractionState = {
  activeTableId: null,
  focusedCell: null,
  hoveredColumnBoundary: null,
  hoveredRowBoundary: null,
  mode: "idle",
  resizingColumn: null,
  draggingColumn: null,
  draggingRow: null,
  selection: null,
};
