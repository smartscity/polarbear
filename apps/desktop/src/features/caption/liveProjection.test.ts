import { describe, expect, it } from "vitest";
import { reconcileSegments } from "./liveProjection";
import type { CaptionSegment } from "./captionAdapter";

const row: CaptionSegment = { id: 1, sessionId: "session", startMs: 0, endMs: 1000, english: "Permanently. Permanently.", chinese: null, translationStatus: "pending" };

describe("live transcript projection", () => {
  it("reuses unchanged snapshots without deleting spoken repetitions", () => {
    const previous = [row];
    expect(reconcileSegments(previous, [{ ...row }])).toBe(previous);
    expect(previous[0].english).toBe("Permanently. Permanently.");
  });
  it("preserves stable rows when a translation or final arrives", () => {
    const second = { ...row, id: 2 };
    const updated = reconcileSegments([row, second], [{ ...row }, { ...second, chinese: "永久", translationStatus: "ready" }]);
    expect(updated[0]).toBe(row);
    expect(updated[1]).not.toBe(second);
    expect(reconcileSegments(updated, [updated[1]])).toEqual([updated[1]]);
  });
  it("does not reuse a row from another session or ignore timing changes", () => {
    expect(reconcileSegments([row], [{ ...row, sessionId: "other" }])[0]).not.toBe(row);
    expect(reconcileSegments([row], [{ ...row, endMs: 2000 }])[0]).not.toBe(row);
  });
});
