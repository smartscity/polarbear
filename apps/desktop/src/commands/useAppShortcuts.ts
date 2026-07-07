import { useEffect } from "react";
import { shortcutDefinitions } from "./appCommandRegistry";
import type { ExecuteAppCommand } from "../model/AppCommand";

const shortcuts = shortcutDefinitions();

export function useAppShortcuts(executeCommand: ExecuteAppCommand): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const usesModKey = event.metaKey || event.ctrlKey;

      if (!usesModKey || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (!event.shiftKey && /^[0-9]$/.test(key)) {
        event.preventDefault();
        const tabIndex = key === "0" ? 9 : Number(key) - 1;
        executeCommand("window.selectTab", {
          commandSource: "shortcut",
          tabIndex,
        });
        return;
      }

      const shortcut = shortcuts.find((candidate) => {
        if (candidate.command === "view.zoomIn" && (key === "+" || key === "=")) {
          return true;
        }

        return (
          candidate.key === key &&
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
