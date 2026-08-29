import { useState } from "react";
import type { TokenSavingsStats } from "./generated/adminV1";

type Props = {
  busy: boolean;
  stats: TokenSavingsStats | null;
  labels: { title: string; saved: string; rate: string; baseline: string; delivered: string; packs: string; since: string; reset: string; confirm: string };
  onReset(): Promise<boolean>;
};

export function TokenSavingsPanel({ busy, stats, labels, onReset }: Props) {
  const [confirmation, setConfirmation] = useState("");
  if (!stats) return null;
  const rate = stats.baselineTokens > 0 ? (stats.estimatedSavedTokens / stats.baselineTokens * 100).toFixed(1) : "0.0";
  const number = new Intl.NumberFormat();
  return <section className="memory-token-savings">
    <h3>{labels.title}</h3>
    <div className="memory-overview">
      <span><strong>{number.format(stats.estimatedSavedTokens)}</strong>{labels.saved}</span>
      <span><strong>{rate}%</strong>{labels.rate}</span>
      <span><strong>{number.format(stats.contextPackCount)}</strong>{labels.packs}</span>
    </div>
    <p>{labels.baseline}: {number.format(stats.baselineTokens)} · {labels.delivered}: {number.format(stats.contextTokens)} · {labels.since}: {new Date(stats.measurementStartedAt).toLocaleString()}</p>
    <div className="memory-inline-fields"><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={labels.confirm} /><button type="button" disabled={busy || confirmation !== "RESET"} onClick={() => void onReset().then((reset) => { if (reset) setConfirmation(""); })}>{labels.reset}</button></div>
  </section>;
}
