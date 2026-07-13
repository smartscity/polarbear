import { useEffect, useMemo, useRef } from "react";
import type { ExecuteAppCommand } from "../shared/commands/appCommandTypes";
import { useUserSettings } from "../shared/settings/useUserSettings";
import {
  getCommandState,
  type CommandRuntimeContext,
} from "./commandState";
import {
  contextFromKeyboardEventTarget,
  findKeybindingConflicts,
  resolveShortcutDefinitions,
  resolveShortcutForKeyboardEvent,
} from "./keybindingResolver";

export function useAppShortcuts(
  executeCommand: ExecuteAppCommand,
  commandContext: CommandRuntimeContext,
): void {
  const settings = useUserSettings();
  const commandContextRef = useRef(commandContext);
  commandContextRef.current = commandContext;
  const shortcuts = useMemo(
    () => resolveShortcutDefinitions(settings.keybindings),
    [settings],
  );

  useEffect(() => {
    const conflicts = findKeybindingConflicts(shortcuts);
    if (import.meta.env.DEV && conflicts.length > 0) {
      console.warn("Polarbear keybinding conflicts", conflicts);
    }
  }, [shortcuts]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return;
      }

      const context = contextFromKeyboardEventTarget(event.target);
      const resolved = resolveShortcutForKeyboardEvent(event, shortcuts, context);
      if (resolved.kind !== "match") {
        return;
      }
      const { shortcut } = resolved;

      const currentCommandContext = commandContextRef.current;
      if (!getCommandState(shortcut.command, currentCommandContext).enabled) {
        return;
      }

      if (shortcut.editorHandled && context.editorFocused) {
        return;
      }
      if (shortcut.when === "fileTreeFocus" && !currentCommandContext.selectedTreeItemId) {
        return;
      }

      event.preventDefault();
      executeCommand(shortcut.command, {
        commandSource: "shortcut",
        targetPath: shortcut.when === "fileTreeFocus"
          ? currentCommandContext.selectedTreeItemId
          : undefined,
      });
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [executeCommand, shortcuts]);
}
