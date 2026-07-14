import { redo, selectAll, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { AppCommand } from "../../shared/commands/appCommandTypes";

type StandardEditorCommand = Extract<
  AppCommand,
  "edit.redo" | "edit.selectAll" | "edit.undo"
>;

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
