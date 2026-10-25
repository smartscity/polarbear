import type { MouseEvent } from "react";
import { effectiveAcceleratorForCommand } from "../../commands/keybindingResolver";
import { openExternalUrl } from "../../shared/tauri/openExternalUrl";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { PRODUCT_CONFIG } from "../../shared/config/productConfig";
import { displayAccelerator } from "../../shared/platform/keyboard";
import { useUserSettings } from "../../shared/settings/useUserSettings";
import { Settings2, Github } from "lucide-react";

type StatusBarProps = {
  activeFileName: string;
  characterCount: number;
  debugEnabled: boolean;
  isDirty: boolean;
  syncMessage: string;
  syncState: "idle" | "busy" | "success" | "error";
  onDebugToggle: () => void;
  onSync: () => void;
  onSettings: () => void;
};

export function StatusBar({
  activeFileName,
  characterCount,
  debugEnabled,
  isDirty,
  syncMessage,
  syncState,
  onDebugToggle,
  onSync,
  onSettings
}: StatusBarProps) {
  const { language, languages, setLanguage, t } = useI18n();
  const userSettings = useUserSettings();
  const syncShortcut = displayAccelerator(
    effectiveAcceleratorForCommand("repository.syncNow", userSettings.keybindings),
  );
  const openProjectLink = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void openExternalUrl(PRODUCT_CONFIG.repositoryUrl);
  };

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        <span>{activeFileName}</span>
        <span>{isDirty ? t("status.unsaved") : t("status.saved")}</span>
        <span>{t("status.characters", { count: characterCount })}</span>
      </div>
      <div className="status-bar-right">
        <button type="button" className="status-sync-button" aria-label={t("settings.title")} title={t("settings.title")} onClick={onSettings}><Settings2 size={16} /></button>
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
          title={syncShortcut
            ? t("status.commandWithShortcut", {
              command: t("status.syncNow"),
              shortcut: syncShortcut,
            })
            : t("status.syncNow")}
          disabled={syncState === "busy"}
          onClick={onSync}
        >
          <span aria-hidden="true">↻</span>
        </button>
        <button
          type="button"
          className={`status-debug-toggle ${debugEnabled ? "active" : ""}`}
          aria-label={t("status.debug")}
          aria-pressed={debugEnabled}
          title={t("status.debug")}
          onClick={onDebugToggle}
        >
          <span aria-hidden="true">{"{}"}</span>
        </button>
        <a
          className="designer-credit"
          title={PRODUCT_CONFIG.copyright}
          aria-label={PRODUCT_CONFIG.copyright}
          href={PRODUCT_CONFIG.repositoryUrl}
          onClick={openProjectLink}
          target="_blank"
          rel="noreferrer"
        >
          <Github size={14} aria-hidden="true" />
        </a>
        <select
          className="status-language-select"
          aria-label={t("status.language")}
          title={t("status.language")}
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          {languages.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </footer>
  );
}
