import { describe, expect, it } from "vitest";
import { EditorState, StateEffect, Transaction } from "@codemirror/state";
import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { TABLE_COMMANDS, executeTableCommand, type TableCommandContext, type TableCommandId } from "./tableCommands";
import { readTableColumnWidths, tableLayoutExtension, tableWidthsEffect, tableWidthsForCommand } from "./tableLayoutState";

const rawTable = "| A | B | C |\n| --- | --- | --- |\n| a | b | c |";

function editor(documentId = "first") {
  let state = EditorState.create({ doc: rawTable, extensions: [history(), tableLayoutExtension(documentId)] });
  return {
    get state() { return state; },
    dispatch: (transaction: Transaction) => { state = transaction.state; },
    resize: (widths: number[]) => {
      state = state.update({ effects: tableWidthsEffect(state, 0, widths), annotations: Transaction.addToHistory.of(false) }).state;
    },
    command: (command: TableCommandId, options: Partial<TableCommandContext> = {}) => {
      const context = { rawTable: state.doc.toString(), column: 0, row: 0, ...options };
      const result = executeTableCommand(command, context);
      const widths = tableWidthsForCommand(readTableColumnWidths(state, 0), command, context, result.rawTable);
      state = state.update({ changes: { from: 0, to: state.doc.length, insert: result.rawTable }, effects: tableWidthsEffect(state, 0, widths) }).state;
    },
  };
}

describe("table layout ownership", () => {
  it("isolates editors, excludes resize from history and never changes Markdown", () => {
    const first = editor();
    first.resize([120, 180, 240]);
    expect(readTableColumnWidths(first.state, 0)).toEqual([120, 180, 240]);
    expect(readTableColumnWidths(editor().state, 0)).toEqual([]);
    expect(first.state.doc.toString()).toBe(rawTable);
    expect(undoDepth(first.state)).toBe(0);
  });

  it("maps positions through prefix edits and undo without restoring a stale resize", () => {
    const view = editor();
    view.resize([120, 180, 240]);
    view.dispatch(view.state.update({ changes: { from: 0, insert: "Intro\n\n" } }));
    expect(readTableColumnWidths(view.state, 7)).toEqual([120, 180, 240]);
    view.dispatch(view.state.update({ effects: tableWidthsEffect(view.state, 7, [150, 180, 240]), annotations: Transaction.addToHistory.of(false) }));
    expect(undo(view)).toBe(true);
    expect(readTableColumnWidths(view.state, 0)).toEqual([150, 180, 240]);
  });

  it.each([
    [TABLE_COMMANDS.columnInsertMultipleBefore, { column: 1, count: 2 }, [120, 0, 0, 180, 240]],
    [TABLE_COMMANDS.columnInsertAfter, { column: 0 }, [120, 0, 180, 240]],
    [TABLE_COMMANDS.columnDuplicate, { selectedColumns: [0, 2] }, [120, 120, 180, 240, 240]],
    [TABLE_COMMANDS.columnDelete, { selectedColumns: [0, 2] }, [180]],
    [TABLE_COMMANDS.columnMoveRight, { column: 0 }, [180, 120, 240]],
    [TABLE_COMMANDS.columnMoveLeft, { column: 2 }, [120, 240, 180]],
    [TABLE_COMMANDS.columnMove, { column: 2, targetColumn: 0 }, [240, 120, 180]],
  ] as const)("keeps %s widths atomic with Markdown undo and redo", (command, options, expected) => {
    const view = editor();
    view.resize([120, 180, 240]);
    view.command(command, { ...options, selectedColumns: "selectedColumns" in options ? [...options.selectedColumns] : undefined });
    const after = view.state.doc.toString();
    expect(readTableColumnWidths(view.state, 0)).toEqual(expected);
    expect(undoDepth(view.state)).toBe(1);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(rawTable);
    expect(readTableColumnWidths(view.state, 0)).toEqual([120, 180, 240]);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(after);
    expect(readTableColumnWidths(view.state, 0)).toEqual(expected);
  });

  it("removes deleted tables and restores their widths only through undo", () => {
    const view = editor();
    view.resize([120, 180, 240]);
    view.dispatch(view.state.update({ changes: { from: 0, to: view.state.doc.length } }));
    expect(readTableColumnWidths(view.state, 0)).toEqual([]);
    expect(undo(view)).toBe(true);
    expect(readTableColumnWidths(view.state, 0)).toEqual([120, 180, 240]);
    expect(redo(view)).toBe(true);
    expect(readTableColumnWidths(view.state, 0)).toEqual([]);
  });

  it("resets on document replacement and rejects effects belonging to the previous document", () => {
    const view = editor();
    view.resize([120, 180, 240]);
    const stale = tableWidthsEffect(view.state, 0, [200]);
    view.dispatch(view.state.update({ effects: StateEffect.reconfigure.of([history(), tableLayoutExtension("second")]) }));
    view.dispatch(view.state.update({ effects: stale }));
    expect(readTableColumnWidths(view.state, 0)).toEqual([]);
    view.dispatch(view.state.update({ effects: StateEffect.reconfigure.of([history(), tableLayoutExtension("first")]) }));
    view.dispatch(view.state.update({ effects: stale }));
    expect(readTableColumnWidths(view.state, 0)).toEqual([]);
  });

  it("preserves widths when deleting every column is refused despite Markdown normalization", () => {
    const view = editor();
    view.dispatch(view.state.update({ changes: { from: 0, to: view.state.doc.length, insert: "|A|B|C|\n|---|---|---|\n|a|b|c|" } }));
    view.resize([120, 180, 240]);
    view.command(TABLE_COMMANDS.columnDelete, { selectedColumns: [0, 1, 2] });
    expect(readTableColumnWidths(view.state, 0)).toEqual([120, 180, 240]);
  });

  it("does not transfer a deleted table layout to its neighbor and restores both on undo", () => {
    const view = editor();
    const offset = rawTable.length + 2;
    view.dispatch(view.state.update({ changes: { from: view.state.doc.length, insert: `\n\n${rawTable}` }, annotations: Transaction.addToHistory.of(false) }));
    view.resize([120, 180, 240]);
    view.dispatch(view.state.update({ effects: tableWidthsEffect(view.state, offset, [200, 210, 220]), annotations: Transaction.addToHistory.of(false) }));
    view.dispatch(view.state.update({ changes: { from: 0, to: offset } }));
    expect(readTableColumnWidths(view.state, 0)).toEqual([200, 210, 220]);
    expect(undo(view)).toBe(true);
    expect(readTableColumnWidths(view.state, 0)).toEqual([120, 180, 240]);
    expect(readTableColumnWidths(view.state, offset)).toEqual([200, 210, 220]);
  });
});
