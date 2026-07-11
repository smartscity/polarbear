import type { MouseEvent } from "react";
import { openExternalUrl } from "../../tauri/externalLinks";
import { useI18n, type AppLanguage } from "../../i18n/I18nProvider";

type StatusBarProps = {
  activeFileName: string;
  characterCount: number;
  debugEnabled: boolean;
  isDirty: boolean;
  syncMessage: string;
  syncState: "idle" | "busy" | "success" | "error";
  onDebugToggle: () => void;
  onSync: () => void;
};

export function StatusBar({
  activeFileName,
  characterCount,
  debugEnabled,
  isDirty,
  syncMessage,
  syncState,
  onDebugToggle,
  onSync
}: StatusBarProps) {
  const { language, setLanguage, t } = useI18n();
  const openProjectLink = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const url = "https://github.com/smartscity/polarbear";
    void openExternalUrl(url);
  };

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        <span>{activeFileName}</span>
        <span>{isDirty ? t("status.unsaved") : t("status.saved")}</span>
        <span>{t("status.characters", { count: characterCount })}</span>
      </div>
      <div className="status-bar-right">
        {syncState !== "idle" && syncMessage ? (
          <span
            className={`status-sync-message ${syncState}`}
            title={syncMessage}
          >
            <span className="status-sync-state-icon" aria-hidden="true">
              {syncState === "success" ? "✓" : syncState === "error" ? "!" : ""}
            </span>
            {syncMessage}
          </span>
        ) : null}
        <button
          type="button"
          className={`status-sync-button ${syncState === "busy" ? "busy" : ""}`}
          aria-label={t("status.syncNow")}
          title={`${t("status.syncNow")} (Command/Control + Option/Alt + S)`}
          disabled={syncState === "busy"}
          onClick={onSync}
        >
          <span aria-hidden="true">↻</span>
        </button>
        {/*<button*/}
        {/*  type="button"*/}
        {/*  className={`status-debug-toggle ${debugEnabled ? "active" : ""}`}*/}
        {/*  aria-pressed={debugEnabled}*/}
        {/*  onClick={onDebugToggle}*/}
        {/*>*/}
        {/*  Debug*/}
        {/*</button>*/}
        <a
          className="designer-credit"
          href="https://github.com/smartscity/polarbear"
          onClick={openProjectLink}
          target="_blank"
          rel="noreferrer"
        >
          Copyright © 2020-2026 smartscity All rights reserved.
        </a>
        <select
          className="status-language-select"
          aria-label={t("status.language")}
          title={t("status.language")}
          value={language}
          onChange={(event) => setLanguage(event.target.value as AppLanguage)}
        >
          <option value="zh-CN">中文</option>
          <option value="en">EN</option>
        </select>
      </div>
    </footer>
  );
}
