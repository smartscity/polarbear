import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { useUserSettings } from "../../shared/settings/useUserSettings";
import { updateUserSettings } from "../../shared/settings/userSettings";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const settings = useUserSettings();
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="reading-settings-dialog" aria-label={t("settings.title")}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header><h2>{t("settings.title")}</h2><button type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button></header>
    <label className="reading-setting"><span><strong>{t("settings.selectionTranslation")}</strong><small>{t("settings.selectionTranslationDescription")}</small></span>
      <input type="checkbox" role="switch" checked={settings.selectionTranslation} onChange={(event) => {
        try { updateUserSettings({ selectionTranslation: event.target.checked }); setFailed(false); } catch { setFailed(true); }
      }} /></label>
    {failed && <p role="alert">{t("settings.saveFailed")}</p>}
  </dialog>;
}
