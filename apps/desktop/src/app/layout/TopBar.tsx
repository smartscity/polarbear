import { useI18n } from "../../shared/i18n/I18nProvider";
import { X, Plus, PanelLeft, ListTree } from "lucide-react";

type TopBarProps = {
  activeTabId: string;
  isDocumentStructureOpen: boolean;
  isSidebarOpen: boolean;
  tabs: Array<{
    id: string;
    isDirty: boolean;
    name: string;
  }>;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onSelectTab: (tabId: string) => void;
  onToggleDocumentStructure: () => void;
  onToggleSidebar: () => void;
};

export function TopBar({
  activeTabId,
  isDocumentStructureOpen,
  isSidebarOpen,
  tabs,
  onCloseTab,
  onNewTab,
  onSelectTab,
  onToggleDocumentStructure,
  onToggleSidebar
}: TopBarProps) {
  const { t } = useI18n();
  return (
    <header className="top-bar">
      <nav className="window-tabs" aria-label={t("top.openFiles")}>
        <div className="window-tab-strip">
          {tabs.length > 0 ? tabs.map((tab) => (
            <div
              key={tab.id}
              className={`window-tab ${tab.id === activeTabId ? "active" : ""}`}
              title={tab.name}
            >
              <button
                type="button"
                className="window-tab-title"
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.name}
                {tab.isDirty ? <span className="window-tab-dirty">•</span> : null}
              </button>
              <button
                type="button"
                className="window-tab-close"
                aria-label={t("top.closeTab", { name: tab.name })}
                onClick={() => onCloseTab(tab.id)}
              >
                <X size={14} />
              </button>
            </div>
          )) : (
            <span className="window-tab-placeholder">{t("top.untitled")}</span>
          )}
        </div>
        <button
          type="button"
          className="window-tab-add"
          aria-label={t("top.newTab")}
          onClick={onNewTab}
        >
          <Plus size={16} />
        </button>
        <div className="window-view-controls" aria-label={t("top.viewToggles")}>
          <button
            type="button"
            className={`window-view-button ${isDocumentStructureOpen ? "active" : ""}`}
            aria-label={t("top.structure")}
            data-sidebar-toggle="right"
            aria-pressed={isDocumentStructureOpen}
            title={t("top.structure")}
            onClick={onToggleDocumentStructure}
          >
            <ListTree size={16} />
          </button>
          <button
            type="button"
            className={`window-view-button ${isSidebarOpen ? "active" : ""}`}
            aria-label={t("top.fileTree")}
            data-sidebar-toggle="left"
            aria-pressed={isSidebarOpen}
            title={t("top.fileTree")}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={16} />
          </button>
        </div>
      </nav>
    </header>
  );
}
