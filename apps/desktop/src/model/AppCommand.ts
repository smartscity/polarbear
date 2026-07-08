export type AppCommand =
  | "app.about"
  | "app.newWindow"
  | "file.newFile"
  | "file.newFolder"
  | "file.openFile"
  | "file.openFolder"
  | "file.save"
  | "file.saveAs"
  | "file.close"
  | "file.rename"
  | "file.move"
  | "file.delete"
  | "file.revealInFinder"
  | "file.copyPath"
  | "workspace.refresh"
  | "workspace.collapseAll"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.selectAll"
  | "edit.find"
  | "edit.findNext"
  | "edit.findPrevious"
  | "format.paragraph"
  | "format.heading1"
  | "format.heading2"
  | "format.heading3"
  | "format.heading4"
  | "format.heading5"
  | "format.heading6"
  | "format.bold"
  | "format.italic"
  | "format.underline"
  | "format.code"
  | "format.link"
  | "format.clearFormat"
  | "format.codeFence"
  | "format.insertImage"
  | "format.quote"
  | "format.orderedList"
  | "format.unorderedList"
  | "format.taskList"
  | "format.mathBlock"
  | "editor.insertTable"
  | "editor.insertCodeFence"
  | "view.toggleSidebar"
  | "view.sourceCode"
  | "view.liveEdit"
  | "view.fileTree"
  | "view.edit"
  | "view.split"
  | "view.preview"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.resetZoom"
  | "repository.connectGithub"
  | "repository.disconnectGithub"
  | "repository.linkWorkspace"
  | "repository.pushWorkspace"
  | "repository.pullWorkspace"
  | "repository.syncNow"
  | "repository.viewSyncStatus"
  | "theme.light"
  | "theme.dark"
  | "window.selectTab";

export type AppCommandPayload = {
  commandSource?: "menu" | "shortcut";
  sourcePath?: string;
  targetParentPath?: string | null;
  targetPath?: string;
  tabIndex?: number;
  workspaceCreate?: boolean;
};

export type ExecuteAppCommand = (
  command: AppCommand,
  payload?: AppCommandPayload
) => void;
