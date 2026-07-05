import type { ExecuteAppCommand } from "../../model/AppCommand";
import type { WorkspaceItem } from "../../model/WorkspaceFile";
import { FileTree } from "../workspace/FileTree";

type SidebarProps = {
  activeFileId: string;
  collapseVersion: number;
  dirtyFileIds: Set<string>;
  folderRevealRequest: { folderId: string; version: number } | null;
  sidebarOpen: boolean;
  statusMessage: string;
  workspaceRoot: string;
  workspaceItems: WorkspaceItem[];
  executeCommand: ExecuteAppCommand;
  renameItemId: string | null;
  selectedTreeItemId: string;
  onRenameCancel: () => void;
  onRenameConfirm: (item: WorkspaceItem, nextName: string) => void;
  onSelectFile: (fileId: string) => void;
  onSelectTreeItem: (itemId: string) => void;
};

export function Sidebar({
  activeFileId,
  collapseVersion,
  dirtyFileIds,
  folderRevealRequest,
  sidebarOpen,
  statusMessage,
  workspaceRoot,
  workspaceItems,
  executeCommand,
  renameItemId,
  selectedTreeItemId,
  onRenameCancel,
  onRenameConfirm,
  onSelectFile,
  onSelectTreeItem
}: SidebarProps) {
  const workspaceName = workspaceRoot
    ? workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace"
    : "No Workspace";

  return (
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-header">
        <div>
          <strong>{workspaceName}</strong>
          <span>{workspaceRoot ? "File Tree" : "Open a folder to start"}</span>
        </div>
      </div>
      {statusMessage ? <p className="workspace-status">{statusMessage}</p> : null}
      <FileTree
        activeFileId={activeFileId}
        collapseVersion={collapseVersion}
        dirtyFileIds={dirtyFileIds}
        executeCommand={executeCommand}
        folderRevealRequest={folderRevealRequest}
        items={workspaceItems}
        renameItemId={renameItemId}
        selectedTreeItemId={selectedTreeItemId}
        onRenameCancel={onRenameCancel}
        onRenameConfirm={onRenameConfirm}
        onSelectFile={onSelectFile}
        onSelectTreeItem={onSelectTreeItem}
      />
      <div className="sidebar-bottom">
        <span className="workspace-path" title={workspaceRoot}>
          {workspaceRoot || "No folder selected"}
        </span>
      </div>
    </aside>
  );
}
