import { useI18n } from "../../i18n/I18nProvider";

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
                <CloseIcon />
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
          +
        </button>
        <div className="window-view-controls" aria-label={t("top.viewToggles")}>
          <button
            type="button"
            className={`window-view-button ${isDocumentStructureOpen ? "active" : ""}`}
            aria-label={t("top.structure")}
            aria-pressed={isDocumentStructureOpen}
            title={t("top.structure")}
            onClick={onToggleDocumentStructure}
          >
            <StructureIcon />
          </button>
          <button
            type="button"
            className={`window-view-button ${isSidebarOpen ? "active" : ""}`}
            aria-label={t("top.fileTree")}
            aria-pressed={isSidebarOpen}
            title={t("top.fileTree")}
            onClick={onToggleSidebar}
          >
            <FileTreePanelIcon />
          </button>
        </div>
      </nav>
    </header>
  );
}

function CloseIcon() {
  return (
    // <svg aria-hidden="true" viewBox="0 0 12 12">
    //   <path d="M3.1 3.1 8.9 8.9M8.9 3.1 3.1 8.9" />
    // </svg>
    <svg aria-hidden="true" viewBox="0 0 12 12">
      <path
          d="M3.25 3.25L8.75 8.75M8.75 3.25L3.25 8.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
      />
    </svg>
  );
}

function StructureIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <path d="M4 4.5h2M8 4.5h6M4 9h2M8 9h6M4 13.5h2M8 13.5h6" />
    </svg>
  );
}

function FileTreePanelIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <path d="M3.5 3.5h11v11h-11z" />
      <path d="M10.5 3.5v11" />
    </svg>
  );
}
