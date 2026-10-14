import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Star } from "lucide-react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { enqueueVocabCapture, vocabCaptureStatus, vocabErrorKey, type ReadingCapture, type VocabReceipt } from "./vocabAdapter";

const STATUS_INTERVAL_MS = 1500;

/** The native outbox owns delivery; unmounting only stops observing its receipt. */
export function VocabFavorite({ capture, onLock }: { capture: ReadingCapture; onLock: () => void }) {
  const { t } = useI18n();
  const attempted = useRef<ReadingCapture | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<VocabReceipt | null>(null);
  const [error, setError] = useState("");
  const receiptId = receipt?.requestId;
  useEffect(() => {
    if (receipt?.state !== "queued" || !receiptId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await vocabCaptureStatus(receiptId);
        if (active) { setReceipt(next); setError(""); }
      } catch (reason) { if (active) setError(vocabErrorKey(reason)); }
      if (active) timer = setTimeout(() => void poll(), STATUS_INTERVAL_MS);
    };
    timer = setTimeout(() => void poll(), STATUS_INTERVAL_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [receipt?.state, receiptId]);

  const save = async () => {
    if (inFlight.current || receipt?.state === "queued" || receipt?.state === "saved") return;
    inFlight.current = true; setBusy(true); setError("");
    attempted.current ??= { ...capture };
    onLock();
    try { setReceipt(await enqueueVocabCapture(attempted.current)); }
    catch (reason) { setError(vocabErrorKey(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const label = busy ? "vocab.saving" : receipt?.state === "saved" ? (attempted.current?.senseUid ? "vocab.saved" : "vocab.pendingSaved") : receipt?.state === "queued" ? "vocab.queued" : "vocab.favorite";
  return <span className="vocab-favorite">
    <button type="button" title={t(label)} aria-label={t(label)} aria-pressed={receipt?.state === "queued" || receipt?.state === "saved"}
      disabled={busy || receipt?.state === "queued" || receipt?.state === "saved"} onClick={() => void save()}>
      {busy ? <LoaderCircle size={18} /> : <Star size={18} fill={receipt?.state === "saved" ? "currentColor" : "none"} />}
    </button>
    {(receipt || error) && <span className="vocab-favorite-status" role={error || receipt?.state === "error" ? "alert" : "status"}>
      {error ? t(error) : t(receipt?.state === "error" ? "vocab.deliveryFailed" : label)}
    </span>}
  </span>;
}
