import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { lookupVocab, saveVocab, speakVocab, vocabErrorKey, type ReadingCapture, type VocabEntry } from "./vocabAdapter";
import { normalizeReadingTerm } from "./readingSelection";
import { PassageReading } from "./PassageReading";

export type ReadingTarget = { capture: ReadingCapture; rect: { left: number; bottom: number } };
const EDGE_GAP = 12;

export function VocabPopover({ target, onClose }: { target: ReadingTarget; onClose: (restoreFocus: boolean) => void }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const attemptedCapture = useRef<ReadingCapture | null>(null);
  const captureRequestId = useRef(target.capture.requestId);
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [sense, setSense] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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
      element.style.top = `${Math.max(EDGE_GAP, Math.min(target.rect.bottom + EDGE_GAP, window.innerHeight - bounds.height - EDGE_GAP))}px`;
    };
    element.showPopover();
    place();
    element.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [target]);

  const save = async () => {
    if (saving || saved || (entries.length > 0 && !selected)) return;
    setSaving(true);
    setError("");
    try {
      const capture = attemptedCapture.current ?? { ...target.capture, requestId: captureRequestId.current, selectedText: lookupText ?? target.capture.selectedText, senseUid: selected?.senseUid ?? null };
      if (!attemptedCapture.current && !includeSource) Object.assign(capture, { sentence: "", title: "", filePath: null, heading: "", line: null });
      attemptedCapture.current = capture;
      const record = await saveVocab(capture);
      if (!record.id || record.capture.selectedText !== capture.selectedText
        || record.capture.senseUid !== capture.senseUid) throw new Error("Invalid capture acknowledgement");
      setSaved(true);
    } catch (reason) { setError(vocabErrorKey(reason)); }
    finally { setSaving(false); }
  };

  return createPortal(<div ref={panel} popover="auto" className="vocab-popover" role="dialog"
    aria-label={t("vocab.lookup")} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(true); }
    }} onToggle={(event) => { if (event.newState === "closed") onClose(false); }}>
    <header className={!normalizeReadingTerm(target.capture.selectedText) ? "reading-passage-header" : undefined}><strong lang="en">{target.capture.selectedText}</strong>
      <button type="button" onClick={() => onClose(true)} aria-label={t("common.close")}>×</button></header>
    <PassageReading text={target.capture.selectedText} lookupDisabled={saving} allowWordLookup={!normalizeReadingTerm(target.capture.selectedText)} onLookup={(term) => {
      if (saving) return;
      captureRequestId.current = crypto.randomUUID();
      attemptedCapture.current = null; setSaved(false); setError(""); setSense(""); setEntries([]); setLookupText(term); setAttempt((value) => value + 1);
    }} />
    {lookupText && (loading ? <p role="status">{t("vocab.loading")}</p> : <>
      {entries.length > 0 ? <fieldset disabled={saved || saving || Boolean(attemptedCapture.current)}>
        <legend>{t("vocab.chooseSense")}</legend>
        {entries.map((entry) => <label className="vocab-sense" key={entry.senseUid}>
          <input type="radio" name="vocab-sense" checked={sense === entry.senseUid}
            onChange={() => setSense(entry.senseUid)} />
          <span><b lang="en">{entry.lemma}</b> <small>{entry.ipa} · {entry.partOfSpeech}</small>
            <span lang="zh-CN">{entry.zhGloss}</span>
            {entry.inMyVocabulary && <small>{t("vocab.alreadyAdded")}</small>}</span>
        </label>)}
      </fieldset> : !error && <p>{t("vocab.notFound")}</p>}
      {selected && lookupText !== target.capture.selectedText && <button type="button" onClick={() => {
        void speakVocab(selected.lemma).catch((reason: unknown) => setError(vocabErrorKey(reason)));
      }}>{t("vocab.pronounce")}</button>}
      <blockquote lang="en">{target.capture.sentence}</blockquote>
      <p className="vocab-source">{target.capture.title}{target.capture.heading ? ` · ${target.capture.heading}` : ""}</p>
      <label><input type="checkbox" checked={includeSource} disabled={saving || saved || Boolean(attemptedCapture.current)}
        onChange={(event) => setIncludeSource(event.target.checked)} /> {t("vocab.includeSource")}</label>
      {saved ? <p role="status">{t(selected ? "vocab.saved" : "vocab.pendingSaved")}</p>
        : <button type="button" className="vocab-save" disabled={saving || (entries.length > 0 && !sense) || Boolean(error && !entries.length)}
          onClick={() => void save()}>{t(saving ? "vocab.saving" : selected?.inMyVocabulary ? "vocab.addSource" : entries.length ? "vocab.add" : "vocab.savePending")}</button>}
    </>)}
    {error && <div role="alert"><p>{t(error)}</p><button type="button" onClick={() => {
      if (attemptedCapture.current) { void save(); return; }
      setError(""); setLoading(true); setAttempt((value) => value + 1);
    }}>{t("vocab.retry")}</button></div>}
  </div>, document.body);
}
