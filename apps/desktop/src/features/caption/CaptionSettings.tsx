import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { useUserSettings } from "../../shared/settings/useUserSettings";
import { TauriCommandError } from "../../shared/tauri/invokeTauri";
import { effectiveAcceleratorForCommand } from "../../commands/keybindingResolver";
import { displayAccelerator } from "../../shared/platform/keyboard";
import { changeCaptionSource, executeCaptionCommand } from "./captionCommands";
import { CaptionSourceSelect } from "./CaptionSourceSelect";
import { captionRequest, type CaptionStatus } from "./captionAdapter";

export function CaptionSettings() {
  const { t } = useI18n();
  const { caption, keybindings } = useUserSettings();
  const shortcut = displayAccelerator(effectiveAcceleratorForCommand("caption.start", keybindings));
  const [status, setStatus] = useState<CaptionStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = status && ["starting", "capturing", "paused"].includes(status.state);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await captionRequest<"status">({ action: "status" }); if (!disposed) setStatus(next); }
      catch (reason) { if (!disposed) setError(reason instanceof TauriCommandError ? reason.code : "caption.operationFailed"); }
      if (!disposed) timer = setTimeout(() => { void poll(); }, 1000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  const run = (command: "caption.toggle" | "caption.history") => {
    setBusy(true); setError("");
    void executeCaptionCommand(command).catch((reason: unknown) => setError(reason instanceof TauriCommandError ? reason.code : "caption.operationFailed")).finally(() => setBusy(false));
  };
  return <section className="caption-settings">
    <label className="reading-setting"><span><strong>{t("caption.title")}</strong>{shortcut && <small><kbd>{shortcut}</kbd></small>}<small>{t("caption.privacy")}</small></span>
      <input type="checkbox" role="switch" checked={Boolean(active)} disabled={busy} onChange={() => run("caption.toggle")} /></label>
    <CaptionSourceSelect source={caption.source} disabled={Boolean(active) || busy} onChange={(source) => {
      setBusy(true); setError("");
      void changeCaptionSource(source).catch((reason: unknown) => setError(reason instanceof TauriCommandError ? reason.code : "caption.operationFailed")).finally(() => setBusy(false));
    }} />
    <button type="button" onClick={() => run("caption.history")} disabled={busy}><History size={16} /> {t("caption.history")}</button>
    {(error || status?.error) && <p role="alert">{t(error || `caption.${status?.error}`)}</p>}
  </section>;
}
