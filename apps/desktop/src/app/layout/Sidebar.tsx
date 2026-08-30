import type { ExecuteAppCommand } from "../../shared/commands/appCommandTypes";
import type { WorkspaceItem } from "../../features/workspace/workspaceModel";
import { FileTree } from "../../features/workspace/components/FileTree";
import { useI18n } from "../../shared/i18n/I18nProvider";

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
  const { t } = useI18n();
  return (
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-header">
        <strong>{workspaceRoot ? t("tree.files") : t("tree.openFolder")}</strong>
      </div>
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
          {workspaceRoot || ""}
        </span>
      </div>
    </aside>
  );
}
