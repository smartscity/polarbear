import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  findFenceBlockAt,
  hasClosingFenceImmediatelyAfter,
  isLineInsideExistingFenceBlock,
} from "./codeFenceState";

/**
 * Completes an unfinished opening fence when Enter is pressed at its end.
 * This remains an editor transaction, so completion is one undoable action.
 */
export function completeFenceBlockOnEnter(view: EditorView): boolean {
  if (!canCompleteFenceBlockOnEnter(view.state)) {
    return false;
  }

  const line = view.state.doc.lineAt(view.state.selection.main.head);
  view.dispatch({
    changes: {
      from: line.to,
      to: line.to,
      insert: "\n\n```",
    },
    selection: EditorSelection.cursor(line.to + 1),
    scrollIntoView: false,
    userEvent: "input.completeCodeBlock",
  });
  return true;
}

export function canCompleteFenceBlockOnEnter(state: EditorState): boolean {
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const line = state.doc.lineAt(selection.head);
  if (selection.head !== line.to) {
    return false;
  }

  if (!/^```([a-zA-Z0-9_-]+)?\s*$/.test(line.text)) {
    return false;
  }

  if (isLineInsideExistingFenceBlock(state, line.number)) {
    return false;
  }

  return !hasClosingFenceImmediatelyAfter(state, line.number, line.text);
}

export function exitFenceBlock(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const block = findFenceBlockAt(view.state, selection.head);
  if (!block) {
    return false;
  }

  const closeLine = view.state.doc.line(block.closeLineNumber);
  const nextLine = closeLine.number < view.state.doc.lines
    ? view.state.doc.line(closeLine.number + 1)
    : null;

  if (nextLine && nextLine.text.trim().length === 0) {
    view.dispatch({
      selection: EditorSelection.cursor(nextLine.from),
      scrollIntoView: true,
      userEvent: "input.exitCodeBlock",
    });
    return true;
  }

  view.dispatch({
    changes: {
      from: closeLine.to,
      to: closeLine.to,
      insert: "\n",
    },
    selection: EditorSelection.cursor(closeLine.to + 1),
    scrollIntoView: true,
    userEvent: "input.exitCodeBlock",
  });

  return true;
}
