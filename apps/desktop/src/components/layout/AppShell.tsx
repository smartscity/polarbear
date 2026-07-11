import type { ReactNode } from "react";
import type { ExecuteAppCommand } from "../../model/AppCommand";
import type { WorkspaceItem } from "../../model/WorkspaceFile";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { useI18n } from "../../i18n/I18nProvider";

type AppShellProps = {
  activeFileId: string;
  activeFileName: string;
  characterCount: number;
  children: ReactNode;
  collapseVersion: number;
  debugEnabled: boolean;
  documentStructureItems: DocumentStructureItem[];
  dirtyFileIds: Set<string>;
  executeCommand: ExecuteAppCommand;
  folderRevealRequest: { folderId: string; version: number } | null;
  isDocumentStructureOpen: boolean;
  isDirty: boolean;
  renameItemId: string | null;
  selectedTreeItemId: string;
  sidebarOpen: boolean;
  statusMessage: string;
  syncMessage: string;
  syncState: "idle" | "busy" | "success" | "error";
  tabs: Array<{
    id: string;
    isDirty: boolean;
    name: string;
  }>;
  workspaceRoot: string;
  workspaceItems: WorkspaceItem[];
  onCloseTab: (tabId: string) => void;
  onDebugToggle: () => void;
  onNewTab: () => void;
  onRenameCancel: () => void;
  onRenameConfirm: (item: WorkspaceItem, nextName: string) => void;
  onSelectDocumentStructureItem: (position: number) => void;
  onSelectFile: (fileId: string) => void;
  onSelectTab: (tabId: string) => void;
  onSelectTreeItem: (itemId: string) => void;
  onSidebarClose: () => void;
  onSync: () => void;
  onToggleDocumentStructure: () => void;
  onToggleSidebar: () => void;
};

export type DocumentStructureItem = {
  id: string;
  label: string;
  level: number;
  position: number;
};

export function AppShell({
  activeFileId,
  activeFileName,
  characterCount,
  children,
  collapseVersion,
  debugEnabled,
  documentStructureItems,
  dirtyFileIds,
  executeCommand,
  folderRevealRequest,
  isDocumentStructureOpen,
  isDirty,
  renameItemId,
  selectedTreeItemId,
  sidebarOpen,
  statusMessage,
  syncMessage,
  syncState,
  tabs,
  workspaceRoot,
  workspaceItems,
  onCloseTab,
  onDebugToggle,
  onNewTab,
  onRenameCancel,
  onRenameConfirm,
  onSelectDocumentStructureItem,
  onSelectFile,
  onSelectTab,
  onSelectTreeItem,
  onSidebarClose,
  onSync,
  onToggleDocumentStructure,
  onToggleSidebar
}: AppShellProps) {
  const { t } = useI18n();
  return (
    <main id="polarbear-app" className="app-shell">
      <TopBar
        activeTabId={activeFileId}
        isDocumentStructureOpen={isDocumentStructureOpen}
        isSidebarOpen={sidebarOpen}
        tabs={tabs}
        onCloseTab={onCloseTab}
        onNewTab={onNewTab}
        onSelectTab={onSelectTab}
        onToggleDocumentStructure={onToggleDocumentStructure}
        onToggleSidebar={onToggleSidebar}
      />
      <section
        className={`main-layout ${sidebarOpen ? "" : "sidebar-collapsed"} ${
          isDocumentStructureOpen ? "structure-open" : ""
        }`}
      >
        {sidebarOpen ? (
          <button
            type="button"
            className="mobile-sidebar-mask"
            aria-label={t("sidebar.close")}
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
        {isDocumentStructureOpen ? (
          <aside className="document-structure-panel">
            <strong>{t("structure.title")}</strong>
            {documentStructureItems.length > 0 ? (
              <nav aria-label={t("structure.label")}>
                {documentStructureItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`document-structure-item level-${item.level}`}
                    onClick={() => onSelectDocumentStructureItem(item.position)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            ) : (
              <span className="document-structure-empty">{t("structure.empty")}</span>
            )}
          </aside>
        ) : null}
      </section>
      <StatusBar
        activeFileName={activeFileName}
        characterCount={characterCount}
        debugEnabled={debugEnabled}
        isDirty={isDirty}
        syncMessage={syncMessage}
        syncState={syncState}
        onDebugToggle={onDebugToggle}
        onSync={onSync}
      />
    </main>
  );
}
