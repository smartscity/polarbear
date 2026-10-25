import { useEffect, useRef, useState } from "react";
import { X, RotateCcw } from "lucide-react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { useUserSettings } from "../../shared/settings/useUserSettings";
import { updateUserSettings } from "../../shared/settings/userSettings";
import { CaptionSettings } from "../../features/caption/CaptionSettings";
import { SettingsSection, SettingsRow } from "../../shared/ui/SettingsSection";

export function SettingsDialog({ onClose, onResetLayout }: { onClose: () => void; onResetLayout?: () => void }) {
  const { t } = useI18n();
  const settings = useUserSettings();
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="reading-settings-dialog" aria-label={t("settings.title")}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header><h2>{t("settings.title")}</h2><button type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button></header>
    <SettingsSection title={t("settings.general")}>
    <SettingsRow label={t("settings.selectionTranslation")} description={t("settings.selectionTranslationDescription")}>
      <input className="settings-toggle" type="checkbox" role="switch" aria-label={t("settings.selectionTranslation")} checked={settings.selectionTranslation} onChange={(event) => {
        void updateUserSettings({ selectionTranslation: event.target.checked }).then(() => setFailed(false)).catch(() => setFailed(true));
      }} />
    </SettingsRow>
    {onResetLayout && <div className="settings-action"><button onClick={onResetLayout}><RotateCcw size={16} />{t("layout.reset")}</button></div>}
    </SettingsSection>
    <CaptionSettings />
    <SettingsSection title={t("settings.privacy")}><p className="settings-description">{t("settings.privacyDescription")}</p></SettingsSection>
    {failed && <p role="alert">{t("settings.saveFailed")}</p>}
  </dialog>;
}
