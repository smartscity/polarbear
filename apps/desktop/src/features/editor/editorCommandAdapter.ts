import { redo, selectAll, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { AppCommand } from "../../shared/commands/appCommandTypes";
import {
  applyMarkdownFormat,
  minimalMarkdownDocumentChange,
} from "./markdown/applyMarkdownFormat";
import { isSelectionInsideFencedCode } from "./markdown/codeFenceState";
import type { MarkdownFormatCommand } from "../../shared/commands/markdownFormatCommands";

type StandardEditorCommand = Extract<AppCommand, "edit.redo" | "edit.selectAll" | "edit.undo">;

/**
 * Runs the standard commands that CodeMirror can execute as one document
 * transaction. Native menus and global commands share this adapter instead of
 * maintaining a second history path.
 */
export function executeStandardEditorCommand(
  view: EditorView | null,
  command: StandardEditorCommand,
): boolean {
  if (!view) {
    return false;
  }

  if (command === "edit.undo") {
    return undo(view);
  }
  if (command === "edit.redo") {
    return redo(view);
  }
  return selectAll(view);
}

/**
 * Applies Markdown formatting from one transaction path for menus, command
 * palette actions, and CodeMirror keybindings.
 */
export function executeMarkdownFormatCommand(
  view: EditorView | null,
  command: MarkdownFormatCommand,
): boolean {
  if (!view) {
    return false;
  }

  if (isSelectionInsideFencedCode(view)) {
    return true;
  }

  const text = view.state.doc.toString();
  const selection = view.state.selection.main;
  const edit = applyMarkdownFormat(command, text, selection);
  if (!edit) {
    return false;
  }

  const change = minimalMarkdownDocumentChange(text, edit.nextText);
  if (!change) {
    return true;
  }

  view.dispatch({
    changes: change,
    selection: {
      anchor: edit.selectionAnchor,
      head: edit.selectionHead,
    },
    scrollIntoView: false,
  });
  view.focus();
  return true;
}
