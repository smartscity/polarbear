import { useEffect } from "react";
import { shortcutDefinitions } from "./appCommandRegistry";
import type { ExecuteAppCommand } from "../model/AppCommand";

const shortcuts = shortcutDefinitions();

export function useAppShortcuts(executeCommand: ExecuteAppCommand): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return;
      }

      const usesModKey = event.metaKey || event.ctrlKey;

      if (!usesModKey) {
        return;
      }

      const key = event.key.toLowerCase();
      const codeKey = keyFromKeyboardCode(event.code);
      const shortcut = shortcuts.find((candidate) => {
        if (candidate.command === "view.zoomIn" && (key === "+" || key === "=")) {
          return !event.altKey;
        }

        return (
          (candidate.key === key || candidate.key === codeKey) &&
          Boolean(candidate.altKey) === event.altKey &&
          Boolean(candidate.shiftKey) === event.shiftKey
        );
      });

      if (!shortcut) {
        return;
      }

      if (shortcut.editorHandled && isInsideCodeMirror(event.target)) {
        return;
      }

      event.preventDefault();
      executeCommand(shortcut.command, { commandSource: "shortcut" });
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [executeCommand]);
}

function isInsideCodeMirror(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest(".typora-live-editor-pane .cm-editor"),
  );
}

function keyFromKeyboardCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toLowerCase();
  }

  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }

  return "";
}
