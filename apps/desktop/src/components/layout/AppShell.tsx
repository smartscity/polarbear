import type { ReactNode } from "react";
import type { ExecuteAppCommand } from "../../model/AppCommand";
import type { WorkspaceItem } from "../../model/WorkspaceFile";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";

type AppShellProps = {
  activeFileId: string;
  activeFileName: string;
  characterCount: number;
  children: ReactNode;
  collapseVersion: number;
  dirtyFileIds: Set<string>;
  executeCommand: ExecuteAppCommand;
  folderRevealRequest: { folderId: string; version: number } | null;
  isDirty: boolean;
  renameItemId: string | null;
  selectedTreeItemId: string;
  sidebarOpen: boolean;
  statusMessage: string;
  workspaceRoot: string;
  workspaceItems: WorkspaceItem[];
  onRenameCancel: () => void;
  onRenameConfirm: (item: WorkspaceItem, nextName: string) => void;
  onSelectFile: (fileId: string) => void;
  onSelectTreeItem: (itemId: string) => void;
  onSidebarClose: () => void;
};

export function AppShell({
  activeFileId,
  activeFileName,
  characterCount,
  children,
  collapseVersion,
  dirtyFileIds,
  executeCommand,
  folderRevealRequest,
  isDirty,
  renameItemId,
  selectedTreeItemId,
  sidebarOpen,
  statusMessage,
  workspaceRoot,
  workspaceItems,
  onRenameCancel,
  onRenameConfirm,
  onSelectFile,
  onSelectTreeItem,
  onSidebarClose
}: AppShellProps) {
  return (
    <main id="polarbear-app" className="app-shell">
      <TopBar activeFileName={activeFileName} isDirty={isDirty} />
      <section
        className={`main-layout ${sidebarOpen ? "" : "sidebar-collapsed"}`}
      >
        {sidebarOpen ? (
          <button
            type="button"
            className="mobile-sidebar-mask"
            aria-label="Close sidebar"
            onClick={onSidebarClose}
          />
        ) : null}
        <Sidebar
          activeFileId={activeFileId}
          collapseVersion={collapseVersion}
          dirtyFileIds={dirtyFileIds}
          folderRevealRequest={folderRevealRequest}
          sidebarOpen={sidebarOpen}
          statusMessage={statusMessage}
          workspaceRoot={workspaceRoot}
          workspaceItems={workspaceItems}
          executeCommand={executeCommand}
          renameItemId={renameItemId}
          selectedTreeItemId={selectedTreeItemId}
          onRenameCancel={onRenameCancel}
          onRenameConfirm={onRenameConfirm}
          onSelectFile={onSelectFile}
          onSelectTreeItem={onSelectTreeItem}
        />
        {children}
      </section>
      <StatusBar
        activeFileName={activeFileName}
        characterCount={characterCount}
        isDirty={isDirty}
      />
    </main>
  );
}
