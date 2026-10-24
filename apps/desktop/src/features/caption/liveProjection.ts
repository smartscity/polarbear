import type { CaptionSegment } from "./captionAdapter";

/** Retain stable row identities across bounded native snapshots. */
export function reconcileSegments(previous: CaptionSegment[], incoming: CaptionSegment[]): CaptionSegment[] {
  const byId = new Map(previous.map(row => [row.id, row]));
  const next = incoming.map(row => {
    const old = byId.get(row.id);
    return old && old.sessionId === row.sessionId && old.startMs === row.startMs && old.endMs === row.endMs
      && old.english === row.english && old.chinese === row.chinese && old.translationStatus === row.translationStatus ? old : row;
  });
  return next.length === previous.length && next.every((row, index) => row === previous[index]) ? previous : next;
}
