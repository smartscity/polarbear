import type { AppCommand } from "../model/AppCommand";

export type ShortcutDefinition = {
  command: AppCommand;
  key: string;
  shiftKey?: boolean;
  editorHandled?: boolean;
};

type CommandDefinition = {
  label: string;
  accelerator?: string;
  shortcut?: ShortcutDefinition;
};

export const appCommandRegistry: Partial<Record<AppCommand, CommandDefinition>> = {
  "app.about": {
    label: "About Polarbear",
  },
  "file.newFile": {
    label: "New",
    accelerator: "CmdOrCtrl+N",
    shortcut: { key: "n", command: "file.newFile" },
  },
  "file.openFile": {
    label: "Open...",
    accelerator: "CmdOrCtrl+O",
    shortcut: { key: "o", command: "file.openFile" },
  },
  "file.save": {
    label: "Save",
    accelerator: "CmdOrCtrl+S",
    shortcut: { key: "s", command: "file.save" },
  },
  "file.saveAs": {
    label: "Save As...",
    accelerator: "Shift+CmdOrCtrl+S",
    shortcut: { key: "s", shiftKey: true, command: "file.saveAs" },
  },
  "file.close": {
    label: "Close",
    accelerator: "CmdOrCtrl+W",
    shortcut: { key: "w", command: "file.close" },
  },
  "edit.find": {
    label: "Find",
    accelerator: "CmdOrCtrl+F",
    shortcut: { key: "f", command: "edit.find" },
  },
  "edit.findNext": {
    label: "Find Next",
    accelerator: "CmdOrCtrl+G",
    shortcut: { key: "g", command: "edit.findNext" },
  },
  "edit.findPrevious": {
    label: "Find Previous",
    accelerator: "Shift+CmdOrCtrl+G",
    shortcut: { key: "g", shiftKey: true, command: "edit.findPrevious" },
  },
  "format.heading1": {
    label: "Heading 1",
  },
  "format.heading2": {
    label: "Heading 2",
  },
  "format.heading3": {
    label: "Heading 3",
  },
  "format.heading4": {
    label: "Heading 4",
  },
  "format.heading5": {
    label: "Heading 5",
  },
  "format.heading6": {
    label: "Heading 6",
  },
  "format.bold": {
    label: "Bold",
    accelerator: "CmdOrCtrl+B",
    shortcut: { key: "b", command: "format.bold", editorHandled: true },
  },
  "format.italic": {
    label: "Italic",
    accelerator: "CmdOrCtrl+I",
    shortcut: { key: "i", command: "format.italic", editorHandled: true },
  },
  "format.underline": {
    label: "Underline",
    accelerator: "CmdOrCtrl+U",
    shortcut: { key: "u", command: "format.underline", editorHandled: true },
  },
  "format.link": {
    label: "Link",
    accelerator: "CmdOrCtrl+K",
    shortcut: { key: "k", command: "format.link", editorHandled: true },
  },
  "format.codeFence": {
    label: "Code Block",
    accelerator: "Shift+CmdOrCtrl+K",
    shortcut: { key: "k", shiftKey: true, command: "format.codeFence", editorHandled: true },
  },
  "format.insertImage": {
    label: "Insert Image...",
    accelerator: "Shift+CmdOrCtrl+I",
    shortcut: { key: "i", shiftKey: true, command: "format.insertImage" },
  },
  "format.mathBlock": {
    label: "Math Block",
    accelerator: "Shift+CmdOrCtrl+M",
    shortcut: { key: "m", shiftKey: true, command: "format.mathBlock", editorHandled: true },
  },
  "view.toggleSidebar": {
    label: "Toggle Sidebar",
    accelerator: "Shift+CmdOrCtrl+L",
    shortcut: { key: "l", shiftKey: true, command: "view.toggleSidebar" },
  },
  "view.sourceCode": {
    label: "Source Code Mode",
    accelerator: "Shift+CmdOrCtrl+E",
    shortcut: { key: "e", shiftKey: true, command: "view.sourceCode" },
  },
  "view.split": {
    label: "Split Mode",
    accelerator: "CmdOrCtrl+\\",
    shortcut: { key: "\\", command: "view.split" },
  },
  "view.preview": {
    label: "Preview Mode",
    accelerator: "Shift+CmdOrCtrl+P",
    shortcut: { key: "p", shiftKey: true, command: "view.preview" },
  },
  "view.resetZoom": {
    label: "Actual Size",
  },
  "view.zoomIn": {
    label: "Zoom In",
    accelerator: "CmdOrCtrl+=",
    shortcut: { key: "=", command: "view.zoomIn" },
  },
  "view.zoomOut": {
    label: "Zoom Out",
    accelerator: "CmdOrCtrl+-",
    shortcut: { key: "-", command: "view.zoomOut" },
  },
};

export function acceleratorForCommand(command: AppCommand): string | undefined {
  return appCommandRegistry[command]?.accelerator;
}

export function shortcutDefinitions(): ShortcutDefinition[] {
  return Object.values(appCommandRegistry)
    .map((definition) => definition?.shortcut)
    .filter((shortcut): shortcut is ShortcutDefinition => Boolean(shortcut));
}
