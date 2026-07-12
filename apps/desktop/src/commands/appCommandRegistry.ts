import type { AppCommand } from "../shared/commands/appCommandTypes";
import type {
  MessageKey,
  Translate,
  TranslationValues,
} from "../shared/i18n/I18nProvider";

export type ShortcutDefinition = {
  command: AppCommand;
  key: string;
  altKey?: boolean;
  shiftKey?: boolean;
  editorHandled?: boolean;
};

type CommandDefinition = {
  titleKey: MessageKey;
  titleValues?: TranslationValues;
  accelerator?: string;
  shortcut?: ShortcutDefinition;
};

export const appCommandRegistry: Record<AppCommand, CommandDefinition> = {
  "app.about": {
    titleKey: "menu.about",
  },
  "app.newWindow": {
    titleKey: "menu.newWindow",
    accelerator: "Shift+CmdOrCtrl+N",
    shortcut: { key: "n", shiftKey: true, command: "app.newWindow" },
  },
  "app.quit": {
    titleKey: "menu.quit",
    accelerator: "CmdOrCtrl+Q",
  },
  "edit.undo": {
    titleKey: "menu.undo",
  },
  "edit.redo": {
    titleKey: "menu.redo",
  },
  "edit.cut": {
    titleKey: "menu.cut",
  },
  "edit.copy": {
    titleKey: "menu.copy",
  },
  "edit.paste": {
    titleKey: "menu.paste",
  },
  "edit.selectAll": {
    titleKey: "menu.selectAll",
  },
  "file.newFile": {
    titleKey: "menu.new",
    accelerator: "CmdOrCtrl+N",
    shortcut: { key: "n", command: "file.newFile" },
  },
  "file.newFolder": {
    titleKey: "tree.newFolder",
  },
  "file.openFile": {
    titleKey: "menu.open",
    accelerator: "CmdOrCtrl+O",
    shortcut: { key: "o", command: "file.openFile" },
  },
  "file.openFolder": {
    titleKey: "tree.openFolder",
  },
  "file.save": {
    titleKey: "menu.save",
    accelerator: "CmdOrCtrl+S",
    shortcut: { key: "s", command: "file.save" },
  },
  "file.saveAs": {
    titleKey: "menu.saveAs",
    accelerator: "Shift+CmdOrCtrl+S",
    shortcut: { key: "s", shiftKey: true, command: "file.saveAs" },
  },
  "file.close": {
    titleKey: "menu.close",
    accelerator: "CmdOrCtrl+W",
    shortcut: { key: "w", command: "file.close" },
  },
  "file.rename": {
    titleKey: "menu.rename",
  },
  "file.delete": {
    titleKey: "menu.delete",
  },
  "file.duplicate": {
    titleKey: "tree.duplicate",
  },
  "file.move": {
    titleKey: "menu.move",
  },
  "file.revealInFinder": {
    titleKey: "tree.reveal",
  },
  "file.copyPath": {
    titleKey: "menu.copyPath",
  },
  "edit.find": {
    titleKey: "menu.find",
    accelerator: "CmdOrCtrl+F",
    shortcut: { key: "f", command: "edit.find" },
  },
  "edit.findNext": {
    titleKey: "menu.findNext",
    accelerator: "CmdOrCtrl+G",
    shortcut: { key: "g", command: "edit.findNext" },
  },
  "edit.findPrevious": {
    titleKey: "menu.findPrevious",
    accelerator: "Shift+CmdOrCtrl+G",
    shortcut: { key: "g", shiftKey: true, command: "edit.findPrevious" },
  },
  "format.paragraph": {
    titleKey: "menu.paragraph",
  },
  "format.heading1": {
    titleKey: "menu.heading",
    titleValues: { level: 1 },
    accelerator: "CmdOrCtrl+1",
    shortcut: { key: "1", command: "format.heading1" },
  },
  "format.heading2": {
    titleKey: "menu.heading",
    titleValues: { level: 2 },
    accelerator: "CmdOrCtrl+2",
    shortcut: { key: "2", command: "format.heading2" },
  },
  "format.heading3": {
    titleKey: "menu.heading",
    titleValues: { level: 3 },
    accelerator: "CmdOrCtrl+3",
    shortcut: { key: "3", command: "format.heading3" },
  },
  "format.heading4": {
    titleKey: "menu.heading",
    titleValues: { level: 4 },
    accelerator: "CmdOrCtrl+4",
    shortcut: { key: "4", command: "format.heading4" },
  },
  "format.heading5": {
    titleKey: "menu.heading",
    titleValues: { level: 5 },
    accelerator: "CmdOrCtrl+5",
    shortcut: { key: "5", command: "format.heading5" },
  },
  "format.heading6": {
    titleKey: "menu.heading",
    titleValues: { level: 6 },
    accelerator: "CmdOrCtrl+6",
    shortcut: { key: "6", command: "format.heading6" },
  },
  "format.bold": {
    titleKey: "menu.bold",
    accelerator: "CmdOrCtrl+B",
    shortcut: { key: "b", command: "format.bold", editorHandled: true },
  },
  "format.italic": {
    titleKey: "menu.italic",
    accelerator: "CmdOrCtrl+I",
    shortcut: { key: "i", command: "format.italic", editorHandled: true },
  },
  "format.underline": {
    titleKey: "menu.underline",
    accelerator: "CmdOrCtrl+U",
    shortcut: { key: "u", command: "format.underline", editorHandled: true },
  },
  "format.link": {
    titleKey: "menu.link",
    accelerator: "CmdOrCtrl+K",
    shortcut: { key: "k", command: "format.link", editorHandled: true },
  },
  "format.code": {
    titleKey: "menu.inlineCode",
  },
  "format.clearFormat": {
    titleKey: "menu.clearFormat",
  },
  "format.codeFence": {
    titleKey: "menu.codeFence",
    accelerator: "Shift+CmdOrCtrl+K",
    shortcut: { key: "k", shiftKey: true, command: "format.codeFence", editorHandled: true },
  },
  "format.insertImage": {
    titleKey: "menu.insertImage",
    accelerator: "Shift+CmdOrCtrl+I",
    shortcut: { key: "i", shiftKey: true, command: "format.insertImage" },
  },
  "format.mathBlock": {
    titleKey: "menu.mathBlock",
    accelerator: "Shift+CmdOrCtrl+M",
    shortcut: { key: "m", shiftKey: true, command: "format.mathBlock", editorHandled: true },
  },
  "format.quote": {
    titleKey: "menu.quote",
  },
  "format.orderedList": {
    titleKey: "menu.orderedList",
  },
  "format.unorderedList": {
    titleKey: "menu.unorderedList",
  },
  "format.taskList": {
    titleKey: "menu.taskList",
  },
  "editor.insertTable": {
    titleKey: "menu.insertTable",
    accelerator: "CmdOrCtrl+Alt+T",
    shortcut: { key: "t", altKey: true, command: "editor.insertTable" },
  },
  "editor.insertCodeFence": {
    titleKey: "menu.insertCodeFence",
  },
  "table.create": { titleKey: "table.create" },
  "table.row.insertBefore": { titleKey: "table.insert.rowBefore" },
  "table.row.insertAfter": { titleKey: "table.insert.rowAfter" },
  "table.row.insertMultipleBefore": { titleKey: "table.insert.rowsBefore" },
  "table.row.insertMultipleAfter": { titleKey: "table.insert.rowsAfter" },
  "table.row.duplicate": { titleKey: "table.row.duplicate" },
  "table.row.moveUp": { titleKey: "table.row.moveUp" },
  "table.row.moveDown": { titleKey: "table.row.moveDown" },
  "table.row.move": { titleKey: "table.row.moveDown" },
  "table.row.clear": { titleKey: "table.row.clear" },
  "table.row.delete": { titleKey: "table.row.delete" },
  "table.row.select": { titleKey: "table.row.select" },
  "table.column.insertBefore": { titleKey: "table.insert.columnBefore" },
  "table.column.insertAfter": { titleKey: "table.insert.columnAfter" },
  "table.column.insertMultipleBefore": { titleKey: "table.insert.columnsBefore" },
  "table.column.insertMultipleAfter": { titleKey: "table.insert.columnsAfter" },
  "table.column.duplicate": { titleKey: "table.column.duplicate" },
  "table.column.moveLeft": { titleKey: "table.column.moveLeft" },
  "table.column.moveRight": { titleKey: "table.column.moveRight" },
  "table.column.move": { titleKey: "table.column.moveRight" },
  "table.column.autoFit": { titleKey: "table.column.autoFit" },
  "table.column.clear": { titleKey: "table.column.clear" },
  "table.column.delete": { titleKey: "table.column.delete" },
  "table.column.select": { titleKey: "table.column.select" },
  "table.copyAsMarkdown": { titleKey: "table.copyAsMarkdown" },
  "table.cell.clear": { titleKey: "table.cell.clear" },
  "table.alignment.setDefault": { titleKey: "table.alignment.default" },
  "table.alignment.setLeft": { titleKey: "table.alignment.left" },
  "table.alignment.setCenter": { titleKey: "table.alignment.center" },
  "table.alignment.setRight": { titleKey: "table.alignment.right" },
  "table.delete": { titleKey: "table.delete" },
  "repository.connectGithub": {
    titleKey: "cloud.connect",
  },
  "repository.disconnectGithub": {
    titleKey: "cloud.disconnect",
  },
  "repository.linkWorkspace": {
    titleKey: "cloud.settings",
  },
  "repository.syncNow": {
    titleKey: "cloud.syncNow",
    accelerator: "CmdOrCtrl+Alt+S",
    shortcut: { key: "s", altKey: true, command: "repository.syncNow" },
  },
  "repository.pullWorkspace": {
    titleKey: "cloud.downloadRemote",
  },
  "repository.pushWorkspace": {
    titleKey: "cloud.uploadLocal",
  },
  "repository.viewSyncStatus": {
    titleKey: "cloud.viewStatus",
  },
  "view.toggleSidebar": {
    titleKey: "menu.toggleSidebar",
    accelerator: "Shift+CmdOrCtrl+L",
    shortcut: { key: "l", shiftKey: true, command: "view.toggleSidebar" },
  },
  "view.sourceCode": {
    titleKey: "menu.sourceMode",
    accelerator: "Shift+CmdOrCtrl+E",
    shortcut: { key: "e", shiftKey: true, command: "view.sourceCode" },
  },
  "view.edit": {
    titleKey: "menu.sourceMode",
  },
  "view.liveEdit": {
    titleKey: "menu.liveMode",
  },
  "view.split": {
    titleKey: "menu.splitMode",
    accelerator: "CmdOrCtrl+\\",
    shortcut: { key: "\\", command: "view.split" },
  },
  "view.preview": {
    titleKey: "menu.previewMode",
    accelerator: "Shift+CmdOrCtrl+P",
    shortcut: { key: "p", shiftKey: true, command: "view.preview" },
  },
  "view.fileTree": {
    titleKey: "menu.fileTree",
  },
  "view.resetZoom": {
    titleKey: "menu.actualSize",
  },
  "view.zoomIn": {
    titleKey: "menu.zoomIn",
    accelerator: "CmdOrCtrl+=",
    shortcut: { key: "=", command: "view.zoomIn" },
  },
  "view.zoomOut": {
    titleKey: "menu.zoomOut",
    accelerator: "CmdOrCtrl+-",
    shortcut: { key: "-", command: "view.zoomOut" },
  },
  "theme.light": {
    titleKey: "menu.light",
  },
  "theme.dark": {
    titleKey: "menu.dark",
  },
  "workspace.refresh": {
    titleKey: "tree.refresh",
  },
  "workspace.collapseAll": {
    titleKey: "tree.collapseAll",
  },
};

export function titleForCommand(command: AppCommand, t: Translate): string {
  const definition = appCommandRegistry[command];
  return t(definition.titleKey, definition.titleValues);
}

export function acceleratorForCommand(command: AppCommand): string | undefined {
  return appCommandRegistry[command].accelerator;
}

export function shortcutDefinitions(): ShortcutDefinition[] {
  return Object.values(appCommandRegistry)
    .map((definition) => definition.shortcut)
    .filter((shortcut): shortcut is ShortcutDefinition => Boolean(shortcut));
}
