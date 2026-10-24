import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { useUserSettings } from "../../shared/settings/useUserSettings";
import { updateUserSettings } from "../../shared/settings/userSettings";
import { TauriCommandError } from "../../shared/tauri/invokeTauri";
import { effectiveAcceleratorForCommand } from "../../commands/keybindingResolver";
import { displayAccelerator } from "../../shared/platform/keyboard";
import { changeCaptionSource, executeCaptionCommand } from "./captionCommands";
import { CaptionSourceSelect } from "./CaptionSourceSelect";
import { captionRequest, type CaptionStatus } from "./captionAdapter";
import { SettingsSection, SettingsRow } from "../../shared/ui/SettingsSection";

export function CaptionSettings() {
  const { t } = useI18n();
  const { caption, keybindings } = useUserSettings();
  const shortcut = displayAccelerator(effectiveAcceleratorForCommand("caption.start", keybindings), { symbols: true });
  const [status, setStatus] = useState<CaptionStatus>();
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const operationPending = useRef(false);
  const active = status && ["starting", "capturing", "paused"].includes(status.state);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const revision = generation.current;
      try { const next = await captionRequest<"status">({ action: "status" }); if (!disposed && !operationPending.current && revision === generation.current) { setStatus(next); setStatusError(""); } }
      catch (reason) { if (!disposed && !operationPending.current && revision === generation.current) setStatusError(reason instanceof TauriCommandError ? reason.code : "caption.operationFailed"); }
      if (!disposed) timer = setTimeout(() => { void poll(); }, 1000);
    };
    void poll();
    return () => { disposed = true; generation.current += 1; clearTimeout(timer); };
  }, []);
  const run = (operation: () => Promise<unknown>) => {
    const revision = ++generation.current;
    operationPending.current = true;
    setBusy(true); setError("");
    void operation().then(() => captionRequest<"status">({ action: "status" }))
      .then((next) => { if (revision === generation.current) setStatus(next); })
      .catch((reason: unknown) => { if (revision === generation.current) setError(reason instanceof TauriCommandError ? reason.code : "caption.operationFailed"); })
      .finally(() => { if (revision === generation.current) { generation.current += 1; operationPending.current = false; setBusy(false); } });
  };
  return <SettingsSection title={t("caption.title")}>
    <SettingsRow label={t("settings.captionEnabled")} description={t("settings.captionDescription")}>
      <input className="settings-toggle" type="checkbox" role="switch" aria-label={t("settings.captionEnabled")} checked={Boolean(active)} disabled={!status || busy || status.state === "stopping"} onChange={() => run(() => executeCaptionCommand("caption.toggle"))} />
    </SettingsRow>
    {shortcut && <SettingsRow label={t("settings.shortcut")}><kbd>{shortcut}</kbd></SettingsRow>}
    <SettingsRow label={t("caption.showChinese")}>
      <input className="settings-toggle" type="checkbox" role="switch" aria-label={t("caption.showChinese")} checked={caption.showChinese} onChange={event => {
        try { updateUserSettings({ caption: { ...caption, showChinese: event.target.checked } }); setError(""); }
        catch { setError("settings.saveFailed"); }
      }} />
    </SettingsRow>
    <CaptionSourceSelect source={active && (status.source === "system" || status.source === "microphone") ? status.source : caption.source} disabled={!status || Boolean(active) || busy || status.state === "stopping"} onChange={(source) => run(() => changeCaptionSource(source))} />
    <div className="settings-action"><button type="button" onClick={() => run(() => executeCaptionCommand("caption.history"))} disabled={busy}><History size={16} aria-hidden="true" /> {t("caption.history")}</button></div>
    {(error || statusError || status?.error) && <p role="alert">{t(error || statusError || `caption.${status?.error}`)}</p>}
  </SettingsSection>;
}
