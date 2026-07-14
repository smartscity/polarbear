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
  primaryModifier?: boolean;
  shiftKey?: boolean;
  editorHandled?: boolean;
  priority?: number;
  when?: CommandShortcutContext;
};

export type CommandShortcutContext =
  | "always"
  | "editorFocus"
  | "fileTreeFocus"
  | "tableCellFocus";

type CommandDefinition = {
  titleKey: MessageKey;
  titleValues?: TranslationValues;
  shortcut?: ShortcutDefinition;
  shortcuts?: ShortcutDefinition[];
};

export const appCommandRegistry: Record<AppCommand, CommandDefinition> = {
  "app.about": {
    titleKey: "menu.about",
  },
  "app.newWindow": {
    titleKey: "menu.newWindow",
    shortcut: { key: "n", shiftKey: true, command: "app.newWindow" },
  },
  "app.quit": {
    titleKey: "menu.quit",
    shortcut: { key: "q", command: "app.quit" },
  },
  "edit.undo": {
    titleKey: "menu.undo",
    shortcut: {
      key: "z",
      command: "edit.undo",
      editorHandled: true,
      priority: 100,
      when: "editorFocus",
    },
  },
  "edit.redo": {
    titleKey: "menu.redo",
    shortcut: {
      key: "z",
      shiftKey: true,
      command: "edit.redo",
      editorHandled: true,
      priority: 100,
      when: "editorFocus",
    },
    shortcuts: [{
      command: "edit.redo",
      editorHandled: true,
      key: "y",
      priority: 100,
      when: "editorFocus",
    }],
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
    shortcut: {
      key: "a",
      command: "edit.selectAll",
      editorHandled: true,
      priority: 100,
      when: "editorFocus",
    },
  },
  "file.newFile": {
    titleKey: "tree.newFile",
    shortcut: { key: "n", command: "file.newFile" },
  },
  "file.newFolder": {
    titleKey: "tree.newFolder",
  },
  "file.openFile": {
    titleKey: "menu.open",
    shortcut: { key: "o", command: "file.openFile" },
  },
  "file.openFolder": {
    titleKey: "tree.openFolder",
  },
  "file.save": {
    titleKey: "menu.save",
    shortcut: { key: "s", command: "file.save" },
  },
  "file.saveAs": {
    titleKey: "menu.saveAs",
    shortcut: { key: "s", shiftKey: true, command: "file.saveAs" },
  },
  "file.close": {
    titleKey: "menu.close",
    shortcut: { key: "w", command: "file.close" },
  },
  "file.rename": {
    titleKey: "menu.rename",
    shortcut: {
      command: "file.rename",
      key: "f2",
      primaryModifier: false,
      when: "fileTreeFocus",
    },
    shortcuts: [{
      command: "file.rename",
      key: "enter",
      primaryModifier: false,
      when: "fileTreeFocus",
    }],
  },
  "file.delete": {
    titleKey: "menu.delete",
    shortcuts: [
      {
        command: "file.delete",
        key: "delete",
        primaryModifier: false,
        when: "fileTreeFocus",
      },
      {
        command: "file.delete",
        key: "backspace",
        primaryModifier: false,
        when: "fileTreeFocus",
      },
    ],
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
    shortcut: { key: "f", command: "edit.find" },
  },
  "edit.findNext": {
    titleKey: "menu.findNext",
    shortcut: { key: "g", command: "edit.findNext" },
  },
  "edit.findPrevious": {
    titleKey: "menu.findPrevious",
    shortcut: { key: "g", shiftKey: true, command: "edit.findPrevious" },
  },
  "format.paragraph": {
    titleKey: "menu.paragraph",
  },
  "format.heading1": {
    titleKey: "menu.heading",
    titleValues: { level: 1 },
    shortcut: { key: "1", command: "format.heading1" },
  },
  "format.heading2": {
    titleKey: "menu.heading",
    titleValues: { level: 2 },
    shortcut: { key: "2", command: "format.heading2" },
  },
  "format.heading3": {
    titleKey: "menu.heading",
    titleValues: { level: 3 },
    shortcut: { key: "3", command: "format.heading3" },
  },
  "format.heading4": {
    titleKey: "menu.heading",
    titleValues: { level: 4 },
    shortcut: { key: "4", command: "format.heading4" },
  },
  "format.heading5": {
    titleKey: "menu.heading",
    titleValues: { level: 5 },
    shortcut: { key: "5", command: "format.heading5" },
  },
  "format.heading6": {
    titleKey: "menu.heading",
    titleValues: { level: 6 },
    shortcut: { key: "6", command: "format.heading6" },
  },
  "format.bold": {
    titleKey: "menu.bold",
    shortcut: {
      key: "b",
      command: "format.bold",
      editorHandled: true,
      priority: 100,
      when: "editorFocus",
    },
  },
  "format.italic": {
    titleKey: "menu.italic",
    shortcut: {
      key: "i",
      command: "format.italic",
      editorHandled: true,
      priority: 100,
      when: "editorFocus",
    },
  },
  "format.underline": {
    titleKey: "menu.underline",
    shortcut: {
      key: "u",
      command: "format.underline",
      editorHandled: true,
      priority: 100,
      when: "editorFocus",
    },
  },
  "format.link": {
    titleKey: "menu.link",
    shortcut: {
      key: "k",
      command: "format.link",
      editorHandled: true,
      priority: 100,
      when: "editorFocus",
    },
  },
  "format.code": {
    titleKey: "menu.inlineCode",
  },
  "format.clearFormat": {
    titleKey: "menu.clearFormat",
  },
  "format.codeFence": {
    titleKey: "menu.codeFence",
    shortcut: {
      key: "k",
      shiftKey: true,
      command: "format.codeFence",
      editorHandled: true,
      priority: 100,
      when: "editorFocus",
    },
  },
  "format.insertImage": {
    titleKey: "menu.insertImage",
    shortcut: { key: "i", shiftKey: true, command: "format.insertImage" },
  },
  "format.mathBlock": {
    titleKey: "menu.mathBlock",
    shortcut: {
      key: "m",
      shiftKey: true,
      command: "format.mathBlock",
      editorHandled: true,
      priority: 100,
      when: "editorFocus",
    },
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
  "table.row.move": { titleKey: "table.row.move" },
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
  "table.column.move": { titleKey: "table.column.move" },
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
    shortcut: { key: "l", shiftKey: true, command: "view.toggleSidebar" },
  },
  "view.sourceCode": {
    titleKey: "menu.sourceMode",
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
    shortcut: { key: "\\", command: "view.split" },
  },
  "view.preview": {
    titleKey: "menu.previewMode",
    shortcut: { key: "p", shiftKey: true, command: "view.preview" },
  },
  "view.fileTree": {
    titleKey: "menu.fileTree",
  },
  "view.resetZoom": {
    titleKey: "menu.actualSize",
    shortcut: { key: "0", command: "view.resetZoom" },
  },
  "view.zoomIn": {
    titleKey: "menu.zoomIn",
    shortcut: { key: "=", command: "view.zoomIn" },
  },
  "view.zoomOut": {
    titleKey: "menu.zoomOut",
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
  const definition = appCommandRegistry[command];
  const shortcut = definition.shortcut
    ?? definition.shortcuts?.find((candidate) => candidate.primaryModifier !== false);
  return shortcut ? nativeAcceleratorForShortcut(shortcut) : undefined;
}

export function shortcutDefinitions(): ShortcutDefinition[] {
  return Object.values(appCommandRegistry)
    .flatMap((definition) => [
      ...(definition.shortcut ? [definition.shortcut] : []),
      ...(definition.shortcuts ?? []),
    ]);
}

function nativeAcceleratorForShortcut(shortcut: ShortcutDefinition): string {
  return [
    shortcut.shiftKey ? "Shift" : "",
    shortcut.primaryModifier !== false ? "CmdOrCtrl" : "",
    shortcut.altKey ? "Alt" : "",
    shortcut.key.toUpperCase(),
  ].filter(Boolean).join("+");
}
