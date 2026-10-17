import { expect, it } from "vitest";
import { captionTimestamp, formatTranscript } from "./transcript";
import type { CaptionSegment } from "./captionAdapter";

const rows: CaptionSegment[] = [
  { id: 1, sessionId: "one", startMs: 1200, endMs: 2800, english: "Hello.", chinese: "你好。", translationStatus: "ready" },
  { id: 2, sessionId: "one", startMs: 3000, endMs: 4000, english: "Keep the original.", chinese: null, translationStatus: "pending" },
];
it("copies finalized bilingual text in order and reports pending translations", () => {
  expect(formatTranscript(rows, { language: "bilingual", timestamps: false })).toEqual({ text: "Hello.\n你好。\n\nKeep the original.", pending: 1 });
});
it("keeps language filtering explicit and never invents a translation", () => {
  expect(formatTranscript(rows, { language: "chinese", timestamps: true })).toEqual({ text: "[00:00:01] 你好。", pending: 1 });
  expect(formatTranscript(rows, { language: "english", timestamps: false }).text).not.toContain("你好");
});
it("exports valid SRT timestamps and handles sessions longer than an hour", () => {
  expect(captionTimestamp(3_661_123, true)).toBe("01:01:01,123");
  expect(formatTranscript(rows, { language: "bilingual", timestamps: false }, "srt").text).toBe("1\n00:00:01,200 --> 00:00:02,800\nHello.\n你好。\n\n2\n00:00:03,000 --> 00:00:04,000\nKeep the original.");
});
