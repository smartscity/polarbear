import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { lookupVocab, vocabErrorKey, type ReadingCapture, type VocabEntry } from "./vocabAdapter";
import { VocabFavorite } from "./VocabFavorite";
import { normalizeReadingTerm } from "./readingSelection";
import { PassageReading } from "./PassageReading";

export type ReadingTarget = { capture: ReadingCapture; rect: { left: number; top?: number; bottom: number } };
const EDGE_GAP = 12;

export function VocabPopover({ target, onClose }: { target: ReadingTarget; onClose: (restoreFocus: boolean) => void }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [captureRequestId, setCaptureRequestId] = useState(target.capture.requestId);
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [sense, setSense] = useState("");
  const [loading, setLoading] = useState(true);
  const [captureLocked, setCaptureLocked] = useState(false);
  const [includeSource, setIncludeSource] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [lookupText, setLookupText] = useState(normalizeReadingTerm(target.capture.selectedText));
  const selected = entries.find((entry) => entry.senseUid === sense);

  useEffect(() => {
    if (!lookupText) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    lookupVocab(lookupText).then((result) => {
      if (!active) return;
      setEntries(result);
      setSense(result.length === 1 ? result[0].senseUid : "");
      setLoading(false);
    }).catch((reason: unknown) => {
      if (active) { setError(vocabErrorKey(reason)); setLoading(false); }
    });
    return () => { active = false; };
  }, [lookupText, attempt]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const place = () => {
      const bounds = element.getBoundingClientRect();
      element.style.left = `${Math.max(EDGE_GAP, Math.min(target.rect.left, window.innerWidth - bounds.width - EDGE_GAP))}px`;
      const below = target.rect.bottom + EDGE_GAP;
      const above = (target.rect.top ?? target.rect.bottom) - bounds.height - EDGE_GAP;
      const top = below + bounds.height <= window.innerHeight - EDGE_GAP ? below : above >= EDGE_GAP ? above : window.innerHeight - bounds.height - EDGE_GAP;
      element.style.top = `${Math.max(EDGE_GAP, top)}px`;
    };
    element.showPopover();
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [target]);

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) onClose(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(true); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [onClose]);

  const capture: ReadingCapture = { ...target.capture, requestId: captureRequestId,
    selectedText: lookupText ?? target.capture.selectedText, senseUid: selected?.senseUid ?? null,
    ...(!includeSource ? { sentence: "", title: "", filePath: null, heading: "", line: null } : {}) };

  return createPortal(<div ref={panel} popover="manual" className="vocab-popover" role="dialog"
    aria-label={t("vocab.lookup")} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(true); }
    }} onToggle={(event) => { if (event.newState === "closed") onClose(false); }}>
    <header className={!lookupText ? "reading-passage-header" : undefined}><strong lang="en">{lookupText ?? target.capture.selectedText}</strong>
      {lookupText && <VocabFavorite key={captureRequestId} capture={capture} onLock={() => setCaptureLocked(true)} />}
      <button type="button" onClick={() => onClose(true)} aria-label={t("common.close")}><X size={18} /></button></header>
    <PassageReading text={lookupText ?? target.capture.selectedText} autoTranslate={!lookupText || (!loading && !entries.length)} lookupDisabled={false} allowWordLookup={!normalizeReadingTerm(target.capture.selectedText)} onLookup={(term) => {
      setCaptureRequestId(crypto.randomUUID());
      setCaptureLocked(false); setError(""); setSense(""); setEntries([]); setLoading(true); setLookupText(term); setAttempt((value) => value + 1);
    }} />
    {lookupText && (loading ? <p role="status">{t("vocab.loading")}</p> : <>
      {entries.length > 0 ? <fieldset disabled={captureLocked}>
        <legend>{t("vocab.chooseSense")}</legend>
        {entries.map((entry) => <label className="vocab-sense" key={entry.senseUid}>
          <input type="radio" name="vocab-sense" checked={sense === entry.senseUid}
            onChange={() => setSense(entry.senseUid)} />
          <span><b lang="en">{entry.lemma}</b> <small>{entry.ipa} · {entry.partOfSpeech}</small>
            {entry.ipaUk && <small>{t("reading.ipaUk")}: {entry.ipaUk}</small>}{entry.ipaUs && <small>{t("reading.ipaUs")}: {entry.ipaUs}</small>}
            <span lang="zh-CN">{entry.zhGloss}</span>
            {entry.inMyVocabulary && <small>{t("vocab.alreadyAdded")}</small>}</span>
        </label>)}
      </fieldset> : !error && <p>{t("vocab.notFound")}</p>}
      <blockquote lang="en">{target.capture.sentence}</blockquote>
      <p className="vocab-source">{target.capture.title}{target.capture.heading ? ` · ${target.capture.heading}` : ""}</p>
      <label><input type="checkbox" checked={includeSource} disabled={captureLocked}
        onChange={(event) => setIncludeSource(event.target.checked)} /> {t("vocab.includeSource")}</label>
    </>)}
    {error && <div className="vocab-lookup-notice" role="status"><p>{t(error)} {t("vocab.offlineCapture")}</p><button type="button" onClick={() => {
      setError(""); setLoading(true); setAttempt((value) => value + 1);
    }}>{t("vocab.retry")}</button></div>}
  </div>, document.body);
}
