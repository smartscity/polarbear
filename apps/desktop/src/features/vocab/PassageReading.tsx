import { useEffect, useRef, useState } from "react";
import { Copy, Volume2 } from "lucide-react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { TauriCommandError } from "../../shared/tauri/invokeTauri";
import { normalizeReadingTerm } from "./readingSelection";
import { prepareReadingLanguages, speakVocab, stopReadingSpeech, translateReadingLocal } from "./vocabAdapter";

export function PassageReading({ text, onLookup, allowWordLookup, lookupDisabled, autoTranslate }: {
  text: string; onLookup: (term: string) => void; allowWordLookup: boolean; lookupDisabled: boolean; autoTranslate: boolean;
}) {
  const { t } = useI18n();
  const [translation, setTranslation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [term, setTerm] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setTranslation(""); setError(""); setBusy(autoTranslate); setCopied(false);
    if (autoTranslate) {
      void translateReadingLocal(text, controller.signal).then((result) => {
        if (!controller.signal.aborted) setTranslation(result);
      }).catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        const code = reason instanceof TauriCommandError ? reason.code : "translationFailed";
        setError(["languagePackMissing", "unsupportedSystem", "buildSdkUnavailable", "windowUnavailable", "unsupportedLanguage", "timeout"].includes(code) ? code : "translationFailed");
      }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }
    return () => { controller.abort(); };
  }, [text, autoTranslate, attempt]);
  useEffect(() => () => { void stopReadingSpeech().catch(() => undefined); }, []);
  const speak = async (accent: "en-US" | "en-GB") => {
    setSpeechError("");
    try { await speakVocab(text, accent); } catch { setSpeechError("reading.error.speechUnavailable"); }
  };
  const prepare = async () => {
    if (preparing) return;
    setPreparing(true);
    try {
      await prepareReadingLanguages();
      if (mounted.current) setAttempt((value) => value + 1);
    } catch { if (mounted.current) setError("languagePreparationFailed"); }
    finally { if (mounted.current) setPreparing(false); }
  };
  return <section className="reading-passage">
    <div className="reading-actions">
      <button type="button" onClick={() => void speak("en-US")} title={t("reading.playUs")}><Volume2 size={16} /> {t("reading.playUs")}</button>
      <button type="button" onClick={() => void speak("en-GB")} title={t("reading.playUk")}><Volume2 size={16} /> {t("reading.playUk")}</button>
    </div>
    {autoTranslate && <p className="reading-local-note">{t("reading.localOnly")}</p>}
    {busy && <p role="status">{t("reading.translating")}</p>}
    {translation && <><p className="reading-translation" lang="zh-CN" aria-live="polite">{translation}</p>
      <button type="button" onClick={() => {
        void navigator.clipboard.writeText(translation).then(() => setCopied(true), () => setError("translationFailed"));
      }}><Copy size={16} /> {t(copied ? "common.copied" : "reading.copyTranslation")}</button></>}
    {error && <div role={error === "languagePackMissing" ? "status" : "alert"}><p>{t("reading.error." + error)}</p>
      <div className="reading-actions">
      {["languagePackMissing", "languagePreparationFailed"].includes(error) && <button type="button" disabled={preparing} onClick={() => void prepare()}>{t(preparing ? "reading.preparingLanguages" : "reading.prepareLanguages")}</button>}
      <button type="button" disabled={preparing} onClick={() => setAttempt((value) => value + 1)}>{t("vocab.retry")}</button></div></div>}
    {speechError && <p role="alert">{t(speechError)}</p>}
    {allowWordLookup && <form onSubmit={(event) => { event.preventDefault(); const normalized = normalizeReadingTerm(term); if (normalized) onLookup(normalized); }}>
      <label>{t("reading.word")}<input value={term} disabled={lookupDisabled} onChange={(event) => setTerm(event.target.value)} maxLength={80} autoComplete="off" /></label>
      <button type="submit" disabled={lookupDisabled || !normalizeReadingTerm(term)}>{t("reading.lookupWord")}</button>
    </form>}
  </section>;
}
