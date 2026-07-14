import type { AppCommand } from "../shared/commands/appCommandTypes";

export type CommandRuntimeContext = {
  activeDocumentId: string;
  activeViewMode: "edit" | "live" | "preview" | "split";
  repositoryConnected: boolean;
  repositoryLinked: boolean;
  repositoryBusy: boolean;
  selectedTreeItemId: string;
  sidebarOpen: boolean;
  theme: "light" | "dark";
  workspaceOpen: boolean;
};

export type CommandState = {
  checked: boolean;
  enabled: boolean;
  visible: boolean;
};

const DEFAULT_COMMAND_STATE: CommandState = {
  checked: false,
  enabled: true,
  visible: true,
};

/**
 * UI entry points query this model instead of re-implementing command guards.
 * Execution still validates filesystem and editor preconditions at the use-case
 * boundary, so a stale menu cannot cause an unsafe operation.
 */
export function getCommandState(
  command: AppCommand,
  context: CommandRuntimeContext,
): CommandState {
  const hasDocument = Boolean(context.activeDocumentId);
  const hasFileTarget = Boolean(context.selectedTreeItemId || context.activeDocumentId);

  if (
    command === "file.save" ||
    command === "file.saveAs" ||
    command === "file.close" ||
    command === "edit.find" ||
    command === "edit.findNext" ||
    command === "edit.findPrevious" ||
    command.startsWith("format.") ||
    command === "editor.insertTable" ||
    command === "editor.insertCodeFence"
  ) {
    return { ...DEFAULT_COMMAND_STATE, enabled: hasDocument };
  }

  if (
    command === "edit.undo" ||
    command === "edit.redo" ||
    command === "edit.selectAll"
  ) {
    return {
      ...DEFAULT_COMMAND_STATE,
      enabled: hasDocument && context.activeViewMode !== "preview",
    };
  }

  if (
    command === "file.rename" ||
    command === "file.delete" ||
    command === "file.duplicate" ||
    command === "file.move" ||
    command === "file.revealInFinder" ||
    command === "file.copyPath"
  ) {
    return {
      ...DEFAULT_COMMAND_STATE,
      enabled: context.workspaceOpen && hasFileTarget,
    };
  }

  if (command === "workspace.refresh" || command === "workspace.collapseAll") {
    return { ...DEFAULT_COMMAND_STATE, enabled: context.workspaceOpen };
  }

  if (command === "repository.connectGithub") {
    return {
      ...DEFAULT_COMMAND_STATE,
      enabled: !context.repositoryBusy && !context.repositoryConnected,
      visible: !context.repositoryConnected,
    };
  }

  if (command === "repository.disconnectGithub") {
    return {
      ...DEFAULT_COMMAND_STATE,
      enabled: !context.repositoryBusy && context.repositoryConnected,
      visible: context.repositoryConnected,
    };
  }

  if (command === "repository.linkWorkspace") {
    return {
      ...DEFAULT_COMMAND_STATE,
      enabled: !context.repositoryBusy && context.repositoryConnected,
      visible: context.repositoryConnected,
    };
  }

  if (
    command === "repository.pushWorkspace" ||
    command === "repository.pullWorkspace" ||
    command === "repository.syncNow" ||
    command === "repository.viewSyncStatus"
  ) {
    return {
      ...DEFAULT_COMMAND_STATE,
      enabled: !context.repositoryBusy && context.repositoryLinked,
      visible: context.repositoryLinked,
    };
  }

  if (command === "view.toggleSidebar") {
    return { ...DEFAULT_COMMAND_STATE, checked: context.sidebarOpen };
  }

  if (command === "view.edit" || command === "view.sourceCode") {
    return {
      ...DEFAULT_COMMAND_STATE,
      checked: context.activeViewMode === "edit",
    };
  }

  if (command === "view.liveEdit") {
    return {
      ...DEFAULT_COMMAND_STATE,
      checked: context.activeViewMode === "live",
    };
  }

  if (command === "view.preview") {
    return {
      ...DEFAULT_COMMAND_STATE,
      checked: context.activeViewMode === "preview",
    };
  }

  if (command === "view.split") {
    return {
      ...DEFAULT_COMMAND_STATE,
      checked: context.activeViewMode === "split",
    };
  }

  if (command === "theme.light") {
    return { ...DEFAULT_COMMAND_STATE, checked: context.theme === "light" };
  }

  if (command === "theme.dark") {
    return { ...DEFAULT_COMMAND_STATE, checked: context.theme === "dark" };
  }

  return DEFAULT_COMMAND_STATE;
}
