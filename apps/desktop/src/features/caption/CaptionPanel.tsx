import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, Check, Copy, Download, History, MoreHorizontal, Pause, Pin, Play, RotateCw, Square, Trash2 } from "lucide-react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { useUserSettings } from "../../shared/settings/useUserSettings";
import { updateUserSettings } from "../../shared/settings/userSettings";
import { TauriCommandError } from "../../shared/tauri/invokeTauri";
import { captionRequest, type CaptionSegment, type CaptionSession, type CaptionStatus } from "./captionAdapter";
import { executeCaptionCommand } from "./captionCommands";
import { captionTimestamp } from "./transcript";
import { applyThemeTokens } from "../theme/themeTokens";
import "./caption.css";

export function CaptionPanel() {
  const { t } = useI18n();
  const settings = useUserSettings();
  const [status, setStatus] = useState<CaptionStatus>();
  const [history, setHistory] = useState(new URLSearchParams(location.search).get("history") === "true");
  const [sessions, setSessions] = useState<CaptionSession[]>([]);
  const [selected, setSelected] = useState<string>();
  const [segments, setSegments] = useState<CaptionSegment[]>([]);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [after, setAfter] = useState(0);
  const [format, setFormat] = useState<"txt" | "md" | "srt">("txt");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [follow, setFollow] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const viewRevision = useRef<number | undefined>(undefined);
  const selectedId = selected ?? status?.sessionId;
  const active = status && ["capturing", "starting", "paused"].includes(status.state);
  const fail = (reason: unknown) => setError(reason instanceof TauriCommandError ? reason.code : "caption.operationFailed");
  const perform = (action: () => Promise<unknown>, success?: () => void) => {
    setBusy(true); setError(""); setNotice("");
    void action().then(success).catch(fail).finally(() => setBusy(false));
  };

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const current = await captionRequest<"status">({ action: "status" });
        const id = selected ?? current.sessionId;
        const rows = id ? selected ? await captionRequest<"segments">({ action: "segments", id, after }) : await captionRequest<"tail">({ action: "tail", id }) : [];
        const list = history ? await captionRequest<"list">({ action: "list", query, offset }) : [];
        if (!disposed) {
          if (current.viewRevision !== undefined && current.viewRevision !== viewRevision.current) {
            viewRevision.current = current.viewRevision;
            setHistory(current.historyRequested); setSelected(undefined); setAfter(0);
          }
          setStatus(current); setSegments(rows); if (history) setSessions(list);
        }
      } catch (reason) { if (!disposed) fail(reason); }
      if (!disposed) timer = setTimeout(() => { void poll(); }, 750);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [selected, history, query, offset, after]);
  useEffect(() => {
    if (follow && scroll.current && !window.getSelection()?.toString()) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [segments, status?.partial, follow]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = settings.theme === "dark" || (settings.theme === "system" && media.matches);
      document.documentElement.dataset.captionTheme = dark ? "dark" : "light";
      applyThemeTokens(dark ? "dark" : "light");
    };
    apply();
    media.addEventListener("change", apply);
    void captionRequest({ action: "pin", pinned: settings.caption.pinned }).catch(fail);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme, settings.caption.pinned]);

  const currentSession = sessions.find((session) => session.id === selected);
  const button = (label: string, icon: React.ReactNode, action: () => void, disabled = false) =>
    <button type="button" aria-label={t(label)} title={t(label)} onClick={action} disabled={disabled || busy}>{icon}</button>;
  const preferences = settings.caption;
  return <main className="caption-panel">
    <header className="caption-header">
      {selected && button("caption.back", <ArrowLeft size={18} />, () => setSelected(undefined))}
      <strong>{t(history ? "caption.history" : "caption.title")}</strong>
      <span className="caption-state" role="status">{t(`caption.state.${status?.state || "idle"}`)}</span>
      <div className="caption-actions">
        {button("caption.copy", <Copy size={18} />, () => perform(async () => {
          const pending = await executeCaptionCommand("caption.copy", selectedId ?? undefined);
          setNotice(t("caption.copied", { count: typeof pending === "number" ? pending : 0 }));
        }), !segments.length)}
        {!history && active && button("caption.pauseResume", status?.state === "paused" ? <Play size={18} /> : <Pause size={18} />, () => perform(() => executeCaptionCommand("caption.pauseResume")))}
        {!history && active && button("caption.stop", <Square size={18} />, () => perform(() => executeCaptionCommand("caption.stop")))}
        {!active && !history && button("caption.start", <Play size={18} />, () => perform(() => executeCaptionCommand("caption.toggle")))}
        {button("caption.history", <History size={18} />, () => { setHistory(!history); setSelected(undefined); })}
        <button type="button" popoverTarget="caption-options" aria-label={t("caption.options")} title={t("caption.options")}><MoreHorizontal size={18} /></button>
      </div>
    </header>
    <div className="caption-options caption-options-popover" id="caption-options" popover="auto">
      {button("caption.pin", <Pin size={18} fill={preferences.pinned ? "currentColor" : "none"} />, () => {
        try { updateUserSettings({ caption: { ...preferences, pinned: !preferences.pinned } }); } catch (reason) { fail(reason); }
      })}
      <label><input type="checkbox" checked={preferences.showChinese} onChange={(event) => {
        try { updateUserSettings({ caption: { ...preferences, showChinese: event.target.checked } }); } catch (reason) { fail(reason); }
      }} />{t("caption.showChinese")}</label>
      <label>{t("caption.copyLanguage")} <select value={preferences.language} onChange={(event) => {
        const language = event.target.value;
        if (language === "english" || language === "chinese" || language === "bilingual") {
          try { updateUserSettings({ caption: { ...preferences, language } }); } catch (reason) { fail(reason); }
        }
      }}>{["bilingual", "english", "chinese"].map((value) => <option key={value} value={value}>{t(`caption.${value}`)}</option>)}</select></label>
      <label><input type="checkbox" checked={preferences.timestamps} onChange={(event) => {
        try { updateUserSettings({ caption: { ...preferences, timestamps: event.target.checked } }); } catch (reason) { fail(reason); }
      }} />{t("caption.timestamps")}</label>
      <label>{t("caption.export")}<select value={format} onChange={(event) => { const value = event.target.value; if (value === "txt" || value === "md" || value === "srt") setFormat(value); }}>
        <option value="txt">TXT</option><option value="md">Markdown</option><option value="srt">SRT</option>
      </select></label>
      {button("caption.export", <Download size={16} />, () => perform(() => executeCaptionCommand("caption.export", selectedId ?? undefined, format)), !segments.length)}
    </div>
    {(error || status?.error) && <p role="alert" className="caption-error">{t(error || `caption.${status?.error}`)}</p>}
    {notice && <p role="status" className="caption-notice"><Check size={14} />{notice}</p>}
    {history && !selected ? <div className="caption-history">
      <input type="search" aria-label={t("caption.search")} placeholder={t("caption.search")} value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} />
      {!sessions.length && <p>{t("caption.noHistory")}</p>}
      {sessions.map((session) => <button key={session.id} type="button" className="caption-session" onClick={() => { setSelected(session.id); setAfter(0); setFollow(false); }}>
        <strong>{session.title || new Date(session.startedAt).toLocaleString()}</strong>
        <span>{session.place} · {t(`caption.${session.source}`)} · {session.count} · {session.timeZone}</span>
      </button>)}
      {offset > 0 && <button onClick={() => setOffset(Math.max(0, offset - 50))}>{t("caption.previous")}</button>}
      {sessions.length === 50 && <button onClick={() => setOffset(offset + 50)}>{t("caption.next")}</button>}
    </div> : <>
      {currentSession && <form className="caption-metadata" key={currentSession.id} onSubmit={(event) => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        perform(() => captionRequest({ action: "rename", id: currentSession.id, title: String(data.get("title") ?? ""), place: String(data.get("place") ?? "") }));
      }}><input name="title" aria-label={t("caption.sessionTitle")} placeholder={t("caption.sessionTitle")} defaultValue={currentSession.title} maxLength={512} />
        <input name="place" aria-label={t("caption.place")} placeholder={t("caption.place")} defaultValue={currentSession.place} maxLength={512} />
        <button type="submit" aria-label={t("caption.save")} title={t("caption.save")}><Check size={16} /></button>
        {button("caption.delete", <Trash2 size={16} />, () => {
          if (window.confirm(t("caption.confirmDelete"))) perform(() => captionRequest({ action: "delete", id: currentSession.id }), () => setSelected(undefined));
        })}
      </form>}
      <div className="caption-transcript" ref={scroll} onScroll={() => {
        const el = scroll.current; if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
      }}>
        {!segments.length && <p className="caption-empty">{t(active ? "caption.listening" : "caption.empty")}</p>}
        {segments.map((segment) => <article key={segment.id}>
          <time>{captionTimestamp(segment.startMs)}</time><p lang="en">{segment.english}</p>
          {preferences.showChinese && <p lang="zh-CN" className="caption-chinese">{segment.chinese || t(`caption.translation.${segment.translationStatus}`)}</p>}
        </article>)}
        {!selected && status?.partial && <p className="caption-partial" lang="en">{status.partial}</p>}
      </div>
      {selected && <div className="caption-options">
        {after > 0 && <button onClick={() => setAfter(0)}>{t("caption.firstPage")}</button>}
        {segments.length === 200 && <button onClick={() => setAfter(segments[segments.length - 1].id)}>{t("caption.next")}</button>}
        {button("caption.retryTranslation", <RotateCw size={16} />, () => perform(() => captionRequest({ action: "retry", id: selected })))}
      </div>}
      {!follow && !selected && <button type="button" className="caption-follow" onClick={() => setFollow(true)}><ArrowDown size={16} />{t("caption.latest")}</button>}
    </>}
    <footer><span>{captionTimestamp(status?.elapsedMs ?? 0)}</span><meter min={0} max={100} value={status?.audioLevel ?? 0} aria-label={t("caption.audioLevel")} title={t("caption.audioLevel")} /><span>{t("caption.localOnly")}</span></footer>
  </main>;
}
