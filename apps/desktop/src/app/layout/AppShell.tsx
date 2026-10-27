import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useWorkspaceResize } from "./useWorkspaceResize";
import type { SidebarSide } from "./workspaceLayout";
import { LAYOUT_LIMITS as L, type LayoutPreferences } from "../../shared/settings/layoutPreferences";
import type { ExecuteAppCommand } from "../../shared/commands/appCommandTypes";
import type { WorkspaceItem } from "../../features/workspace/workspaceModel";
import type { DocumentStructureItem } from "../../features/editor/documentModel";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { useI18n } from "../../shared/i18n/I18nProvider";

type AppShellProps = {
  layoutPreferences: LayoutPreferences;
  onLayoutChange: (patch: Partial<LayoutPreferences>) => void;
  splitView: boolean;
  activeFileId: string;
  activeRelativePath: string;
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

export function AppShell({
  layoutPreferences, onLayoutChange, splitView,
  activeFileId,
  activeRelativePath,
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
  onSync,
  onToggleDocumentStructure,
  onToggleSidebar
}: AppShellProps) {
  const { t } = useI18n();
  const layout = useWorkspaceResize(layoutPreferences, splitView, onLayoutChange);
  const [drawer, setDrawer] = useState<SidebarSide | null>(null);
  const shell = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const drawerVisible = drawer && !layout.effective[drawer] ? drawer : null;
  const leftVisible = Boolean(layout.effective.left) || drawerVisible === "left";
  const rightVisible = Boolean(layout.effective.right) || drawerVisible === "right";
  const toggle = (side: SidebarSide) => {
    if (!layout.effective[side] && layout.width < (splitView ? L.splitEditorMin : L.editorMin) + L.minWidth + L.separator) {
      setDrawer(drawerVisible === side ? null : side);
    } else if (side === "right" && !layout.effective.right && isDocumentStructureOpen) {
      setDrawer(drawerVisible === side ? null : side);
    } else if (side === "left") onToggleSidebar();
    else onToggleDocumentStructure();
  };
  useLayoutEffect(() => { setDrawer(null); }, [layout.width]);
  useLayoutEffect(() => {
    if (!drawerVisible) return;
    // WebKit does not focus buttons on pointer clicks. Restore the actual
    // drawer trigger instead of whichever editor control happened to be active.
    previousFocus.current = shell.current?.querySelector<HTMLElement>(`[data-sidebar-toggle="${drawerVisible}"]`) ?? null;
    shell.current?.querySelector<HTMLElement>(".workspace-drawer-close")?.focus({ preventScroll: true });
    return () => { previousFocus.current?.focus({ preventScroll: true }); };
  }, [drawerVisible]);
  useLayoutEffect(() => {
    for (const [id, visible, control] of [["workspace-sidebar", leftVisible, "left"], ["workspace-outline", rightVisible, "right"]] as const) {
      if (!visible && document.activeElement && document.getElementById(id)?.contains(document.activeElement)) {
        shell.current?.querySelector<HTMLElement>(`[data-sidebar-toggle="${control}"]`)?.focus({ preventScroll: true });
      }
    }
  }, [leftVisible, rightVisible]);
  return (
    <main ref={shell} id="polarbear-app" className="app-shell" onKeyDown={(event) => {
      if (!drawerVisible) return;
      if (event.key === "Escape") { event.preventDefault(); setDrawer(null); }
      if (event.key === "Tab") {
        const controls = Array.from(shell.current?.querySelectorAll<HTMLElement>(".workspace-drawer button:not(:disabled), .workspace-drawer input:not(:disabled), .workspace-drawer [tabindex='0']") ?? []).filter((node) => node.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <TopBar
        activeTabId={activeFileId}
        isDocumentStructureOpen={rightVisible}
        isSidebarOpen={leftVisible}
        tabs={tabs}
        onCloseTab={onCloseTab}
        onNewTab={onNewTab}
        onSelectTab={onSelectTab}
        onToggleDocumentStructure={() => toggle("right")}
        onToggleSidebar={() => toggle("left")}
      />
      <section
        ref={layout.container}
        className="main-layout"
      >
        {drawerVisible ? (
          <button
            type="button"
            className="workspace-drawer-mask"
            aria-label={t("layout.closePanel")}
            tabIndex={-1}
            onClick={() => setDrawer(null)}
          />
        ) : null}
        <div id="workspace-sidebar" className={`workspace-sidebar-slot ${drawerVisible === "left" ? "workspace-drawer" : ""}`} inert={!leftVisible || (drawerVisible === "right")} aria-hidden={!leftVisible}>
        {drawerVisible === "left" && <button className="workspace-drawer-close" aria-label={t("layout.closePanel")} onClick={() => setDrawer(null)}><X size={16} /></button>}
        <Sidebar
          activeFileId={activeRelativePath}
          collapseVersion={collapseVersion}
          dirtyFileIds={dirtyFileIds}
          folderRevealRequest={folderRevealRequest}
          sidebarOpen={leftVisible}
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
        </div>
        <div className="workspace-separator left" aria-label={t("layout.resizeLeft")} {...layout.separatorProps("left")} />
        <div className="workspace-editor-slot" inert={Boolean(drawerVisible)}>{children}</div>
        <div className="workspace-separator right" aria-label={t("layout.resizeRight")} {...layout.separatorProps("right")} />
        <div id="workspace-outline" className={`workspace-outline-slot ${drawerVisible === "right" ? "workspace-drawer" : ""}`} inert={!rightVisible || (drawerVisible === "left")} aria-hidden={!rightVisible}>
        {drawerVisible === "right" && <button className="workspace-drawer-close" aria-label={t("layout.closePanel")} onClick={() => setDrawer(null)}><X size={16} /></button>}
          <aside className="document-structure-panel">
            <strong>{t("structure.title")}</strong>
            {documentStructureItems.length > 0 ? (
              <nav aria-label={t("structure.label")}>
                {documentStructureItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`document-structure-item level-${item.level}`}
                    title={item.label}
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
        </div>
      </section>
      <StatusBar
        onSettings={() => executeCommand("app.settings")}
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
