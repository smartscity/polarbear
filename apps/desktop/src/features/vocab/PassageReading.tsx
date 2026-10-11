import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { TauriCommandError } from "../../shared/tauri/invokeTauri";
import { normalizeReadingTerm } from "./readingSelection";
import { speakVocab, translateReadingLocal, vocabErrorKey } from "./vocabAdapter";

export function PassageReading({ text, onLookup, allowWordLookup, lookupDisabled }: { text: string; onLookup: (term: string) => void; allowWordLookup: boolean; lookupDisabled: boolean }) {
  const { t } = useI18n();
  const [translation, setTranslation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [term, setTerm] = useState("");
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, [text]);
  const translate = async () => {
    if (busy) return;
    const current = revision.current;
    setBusy(true); setError(""); setTranslation("");
    try {
      const result = await translateReadingLocal(text);
      if (revision.current === current) setTranslation(result);
    } catch (reason) {
      if (revision.current === current) {
        const code = reason instanceof TauriCommandError ? reason.code : "translationFailed";
        setError(["languagePackMissing", "unsupportedSystem", "unsupportedLanguage", "timeout"].includes(code) ? code : "translationFailed");
      }
    } finally { if (revision.current === current) setBusy(false); }
  };
  return <section className="reading-passage">
    <div className="reading-actions">
      <button type="button" disabled={busy} onClick={() => void translate()}>{t(busy ? "reading.translating" : "reading.translate")}</button>
      <button type="button" onClick={() => {
        setSpeechError("");
        void speakVocab(text).catch((reason: unknown) => setSpeechError(vocabErrorKey(reason)));
      }}>{t("reading.playEnglish")}</button>
    </div>
    <p className="reading-local-note">{t("reading.localOnly")}</p>
    {translation && <p className="reading-translation" lang="zh-CN" aria-live="polite">{translation}</p>}
    {error && <p role="alert">{t(`reading.error.${error}`)}</p>}
    {speechError && <p role="alert">{t(speechError)}</p>}
    {allowWordLookup && <form onSubmit={(event) => { event.preventDefault(); const normalized = normalizeReadingTerm(term); if (normalized) onLookup(normalized); }}>
      <label>{t("reading.word")}<input value={term} disabled={lookupDisabled} onChange={(event) => setTerm(event.target.value)} maxLength={80} autoComplete="off" /></label>
      <button type="submit" disabled={lookupDisabled || !normalizeReadingTerm(term)}>{t("reading.lookupWord")}</button>
    </form>}
  </section>;
}
