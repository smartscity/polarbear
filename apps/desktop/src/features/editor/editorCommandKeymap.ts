import type { KeyBinding, EditorView } from "@codemirror/view";
import { codeMirrorKeysForCommand } from "../../commands/keybindingResolver";
import type { AppCommand } from "../../shared/commands/appCommandTypes";
import {
  MARKDOWN_FORMAT_COMMANDS,
  type MarkdownFormatCommand,
} from "../../shared/commands/markdownFormatCommands";
import type { KeybindingOverrides } from "../../shared/settings/userSettings";
import { executeStandardEditorCommand } from "./editorCommandAdapter";

type EditorCommandKeymapOptions = {
  keybindingOverrides: KeybindingOverrides;
  runMarkdownFormatCommand: (
    view: EditorView,
    command: MarkdownFormatCommand,
  ) => boolean;
};

const STANDARD_EDITOR_COMMANDS = [
  "edit.selectAll",
  "edit.undo",
  "edit.redo",
] as const;

/**
 * Produces CodeMirror bindings from the app command registry. The caller owns
 * only how a formatting command reaches the active editor; shortcut parsing,
 * user overrides, and standard history actions stay shared.
 */
export function createEditorCommandBindings(
  options: EditorCommandKeymapOptions,
): KeyBinding[] {
  return [
    ...MARKDOWN_FORMAT_COMMANDS.flatMap((command) =>
      bindingsForCommand(command, options.keybindingOverrides, (view) =>
        options.runMarkdownFormatCommand(view, command),
      ),
    ),
    ...STANDARD_EDITOR_COMMANDS.flatMap((command) =>
      bindingsForCommand(command, options.keybindingOverrides, (view) =>
        executeStandardEditorCommand(view, command),
      ),
    ),
  ];
}

function bindingsForCommand(
  command: AppCommand,
  overrides: KeybindingOverrides,
  run: KeyBinding["run"],
): KeyBinding[] {
  return codeMirrorKeysForCommand(command, overrides).map((key) => ({
    key,
    preventDefault: true,
    run,
  }));
}
