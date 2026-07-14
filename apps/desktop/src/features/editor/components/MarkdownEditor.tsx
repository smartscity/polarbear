import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { redo, selectAll, undo } from "@codemirror/commands";
import { search } from "@codemirror/search";
import { Prec } from "@codemirror/state";
import { keymap, type EditorView, type KeyBinding } from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import { codeMirrorKeyForCommand } from "../../../commands/keybindingResolver";
import type { AppCommand } from "../../../shared/commands/appCommandTypes";
import { useUserSettings } from "../../../shared/settings/useUserSettings";
import type { KeybindingOverrides } from "../../../shared/settings/userSettings";
import { platformNavigationKeymap } from "./platformNavigationKeymap";

export type MarkdownEditorView = EditorView;

type DroppedFile = File & {
  path?: string;
};

type MarkdownEditorProps = {
  markdownContent: string;
  onImageDrop: (filePaths: string[]) => void;
  onImagePaste: (items: DataTransferItemList) => void;
  onCommand: (command: AppCommand) => void;
  onEditorReady: (editorView: MarkdownEditorView | null) => void;
  onMarkdownChange: (markdownContent: string) => void;
};

export function MarkdownEditor({
  markdownContent,
  onImageDrop,
  onImagePaste,
  onCommand,
  onEditorReady,
  onMarkdownChange
}: MarkdownEditorProps) {
  const userSettings = useUserSettings();
  const commandKeymap = useMemo(
    () => sourceEditorCommandKeymap(userSettings.keybindings, onCommand),
    [onCommand, userSettings.keybindings],
  );
  const onEditorReadyRef = useRef(onEditorReady);

  useEffect(() => {
    onEditorReadyRef.current = onEditorReady;
  }, [onEditorReady]);

  useEffect(() => () => onEditorReadyRef.current(null), []);

  return (
    <section
      className="editor-pane"
      data-editor-document-host="true"
      data-editor-document-mode="source"
      data-editor-document-surface="true"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => (file as DroppedFile).path ?? "")
          .filter(Boolean);

        if (paths.length > 0) {
          event.preventDefault();
          onImageDrop(paths);
        }
      }}
      onPaste={(event) => {
        const hasImage = Array.from(event.clipboardData.items).some((item) =>
          item.type.startsWith("image/")
        );

        if (hasImage) {
          event.preventDefault();
          onImagePaste(event.clipboardData.items);
        }
      }}
    >
      <CodeMirror
        value={markdownContent}
        height="100%"
        extensions={[
          platformNavigationKeymap(),
          commandKeymap,
          markdown(),
          search({ top: true }),
        ]}
        onCreateEditor={(editorView) => onEditorReady(editorView)}
        onChange={onMarkdownChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true
        }}
      />
    </section>
  );
}

function sourceEditorCommandKeymap(
  keybindingOverrides: KeybindingOverrides,
  onCommand: (command: AppCommand) => void,
) {
  const commandBinding = (
    command: AppCommand,
    fallback: string,
  ): KeyBinding | null => {
    const key = codeMirrorKeyForCommand(command, fallback, keybindingOverrides);
    return key
      ? {
          key,
          preventDefault: true,
          run: () => {
            onCommand(command);
            return true;
          },
        }
      : null;
  };
  const directBinding = (
    command: AppCommand,
    fallback: string,
    run: KeyBinding["run"],
  ): KeyBinding | null => {
    const key = codeMirrorKeyForCommand(command, fallback, keybindingOverrides);
    return key ? { key, run } : null;
  };

  const bindings = [
    commandBinding("format.bold", "Mod-b"),
    commandBinding("format.italic", "Mod-i"),
    commandBinding("format.underline", "Mod-u"),
    commandBinding("format.link", "Mod-k"),
    commandBinding("format.codeFence", "Mod-Shift-k"),
    commandBinding("format.mathBlock", "Mod-Shift-m"),
    ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
      commandBinding(`format.heading${level}`, `Mod-${level}`),
    ),
    directBinding("edit.selectAll", "Mod-a", selectAll),
    directBinding("edit.undo", "Mod-z", undo),
    directBinding("edit.redo", "Mod-Shift-z", redo),
    keybindingOverrides["edit.redo"] === undefined
      ? { key: "Mod-y", run: redo }
      : null,
  ].filter((binding): binding is KeyBinding => binding !== null);

  return Prec.highest(keymap.of(bindings));
}
