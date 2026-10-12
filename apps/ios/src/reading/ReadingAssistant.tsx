import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, BookOpen, Expand, Languages, Send, Square, Trash2, Volume2, X } from "lucide-react";
import { useI18n } from "../../../desktop/src/shared/i18n/I18nProvider";
import { Sheet } from "../ui/Sheet";
import { readingAdapter, readingErrorKey } from "./readingAdapter";
import { captureSelection, readingTerm, readingText, type ReadingCapture, type ReadingSelection } from "./readingModel";

export function ReadingAssistant({ selection, dismiss, manual, closeManual }: {
  selection: ReadingSelection | null; dismiss: () => void; manual: boolean; closeManual: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [typed, setTyped] = useState<ReadingSelection | null>(null);
  const [term, setTerm] = useState("");
  const [source, setSource] = useState(true);
  const [translation, setTranslation] = useState("");
  const [translating, setTranslating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [translationError, setTranslationError] = useState("");
  const [pending, setPending] = useState<ReadingCapture[] | null>(null);
  const [shared, setShared] = useState(false);
  const current = manual ? typed : selection;
  const text = current?.text ?? "";
  const generation = useRef(0);
  const capture = useRef<ReadingCapture | null>(null);

  useEffect(() => {
    const revision = ++generation.current;
    setTranslation(""); setTranslationError(""); setError(""); setSaved(false); setPlaying(false);
    setTerm(readingTerm(text) ?? ""); capture.current = null;
    setTranslating(!!text);
    if (text) {
      void readingAdapter.translate(text).then((result) => {
        if (revision === generation.current) setTranslation(result.text);
      }).catch((error: unknown) => {
        if (revision === generation.current) setTranslationError(readingErrorKey(error));
      }).finally(() => { if (revision === generation.current) setTranslating(false); });
    }
    return () => {
      generation.current = revision + 1;
      // Cancellation is best-effort when running the browser-only preview.
      void readingAdapter.cancel().catch(() => undefined);
      void readingAdapter.stop().catch(() => undefined);
    };
  }, [text, current]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) { void readingAdapter.stop().catch(() => undefined); setPlaying(false); }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    const revision = generation.current;
    try { await action(); } catch (error) { if (revision === generation.current) setError(readingErrorKey(error)); }
    finally { setBusy(false); }
  };
  const speak = async () => {
    const revision = generation.current;
    setError("");
    try {
      if (playing) { await readingAdapter.stop(); setPlaying(false); return; }
      setPlaying(true); await readingAdapter.speak(text);
    } catch (error) { if (revision === generation.current) setError(readingErrorKey(error)); }
    finally { if (revision === generation.current) setPlaying(false); }
  };
  const save = () => perform(async () => {
    if (!current) return;
    const revision = generation.current;
    const word = readingTerm(term);
    if (!word) { setExpanded(true); return; }
    capture.current ??= captureSelection(current, word, source);
    await readingAdapter.save(capture.current);
    if (revision === generation.current) setSaved(true);
  });
  const close = () => { setExpanded(false); setPending(null); setTyped(null); closeManual(); dismiss(); };
  const actions = <div className="reading-actions">
    <button className="icon-button" onClick={() => void speak()} disabled={!text} aria-label={t(playing ? "reader.reading.stop" : "reader.reading.play")} title={t(playing ? "reader.reading.stop" : "reader.reading.play")}>{playing ? <Square /> : <Volume2 />}</button>
    <button disabled={busy || saved || !text} onClick={() => { if (!readingTerm(term)) setExpanded(true); else void save(); }}><BookmarkPlus size={18} />{t(saved ? "reader.reading.queued" : "reader.reading.add")}</button>
    <button className="icon-button" disabled={!readingTerm(text)} aria-label={t("reader.reading.dictionary")} title={t("reader.reading.dictionary")} onClick={() => void perform(() => readingAdapter.dictionary(text))}><BookOpen /></button>
  </div>;
  const result = <>
    {translating && <p role="status">{t("reader.reading.translating")}</p>}
    {translation && <p className="reading-translation" lang="zh-Hans">{translation}</p>}
    {translationError && <p className="reading-note" role="status">{t(translationError)}</p>}
    {error && <p className="reading-error" role="alert">{t(error)}</p>}
  </>;
  const isSheet = manual || expanded || pending !== null;
  if (!current && !manual && pending === null) return null;

  return <>
    {!isSheet && current && <aside className="reading-assistant" data-dock={current.dock ?? "bottom"} aria-label={t("reader.reading.tools")} onPointerDown={(e) => { if (e.pointerType === "mouse") e.preventDefault(); }}>
      <header><strong lang="en">{text}</strong><button className="icon-button" onClick={() => setExpanded(true)} aria-label={t("reader.reading.expand")}><Expand /></button><button className="icon-button" onClick={close} aria-label={t("common.close")}><X /></button></header>
      {result}{actions}
    </aside>}
    {isSheet && <Sheet title={t(pending ? "reader.reading.pending" : "reader.reading.tools")} close={close}>
      {pending ? <>
        <p className="reading-note">{t("reader.reading.transferHelp")}</p>
        <button disabled={busy || !pending.length} onClick={() => void perform(async () => { const result = await readingAdapter.share(); setShared(result.shared); })}><Send size={18} /> {t("reader.reading.export")}</button>
        {shared && <p role="status">{t("reader.reading.shared")}</p>}
        {!pending.length && <p>{t("reader.reading.empty")}</p>}
        <ul className="reading-pending">{pending.map((item) => <li key={item.requestId}><span><strong>{item.selectedText}</strong><small>{item.title}</small></span><button className="icon-button" disabled={busy} aria-label={t("reader.reading.remove")} onClick={() => void perform(async () => { await readingAdapter.remove(item.requestId); setPending(await readingAdapter.list()); })}><Trash2 /></button></li>)}</ul>
        {error && <p role="alert">{t(error)}</p>}
      </> : <>
        {manual && <form className="reading-search" onSubmit={(e) => {
          e.preventDefault(); const text = readingText(input);
          if (text) setTyped({ text, sentence: text, heading: "", title: "" }); else setError("reader.reading.error.invalidTerm");
        }}><input aria-label={t("reader.reading.input")} placeholder={t("reader.reading.input")} value={input} maxLength={2000} onChange={(e) => setInput(e.target.value)} /><button className="icon-button" aria-label={t("reader.reading.translate")}><Languages /></button></form>}
        {text && <p lang="en" className="reading-source">{text}</p>}
        {result}{actions}
        {!!text && <label className="reading-word">{t("reader.reading.word")}<input value={term} maxLength={80} onChange={(e) => { setTerm(e.target.value); capture.current = null; setSaved(false); }} /></label>}
        {!!text && <label className="reading-source-toggle"><input type="checkbox" checked={source} onChange={(e) => { setSource(e.target.checked); capture.current = null; setSaved(false); }} />{t("reader.reading.includeSource")}</label>}
        <button disabled={busy} onClick={() => void perform(async () => setPending(await readingAdapter.list()))}>{t("reader.reading.pending")}</button>
      </>}
    </Sheet>}
  </>;
}
