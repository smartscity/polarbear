import type { CaptionSegment } from "./captionAdapter";

export type CaptionLanguage = "bilingual" | "english" | "chinese";
export type TranscriptOptions = { language: CaptionLanguage; timestamps: boolean };

export function captionTimestamp(milliseconds: number, srt = false): string {
  const value = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(value / 3_600_000).toString().padStart(2, "0");
  const minutes = Math.floor(value / 60_000 % 60).toString().padStart(2, "0");
  const seconds = Math.floor(value / 1000 % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}${srt ? `,${(value % 1000).toString().padStart(3, "0")}` : ""}`;
}

export function formatTranscript(segments: readonly CaptionSegment[], options: TranscriptOptions, format: "txt" | "md" | "srt" = "txt") {
  let pending = 0;
  let index = 0;
  const blocks = segments.flatMap((segment) => {
    if (!segment.chinese) pending++;
    const lines = [options.language !== "chinese" ? segment.english.trim() : "", options.language !== "english" ? segment.chinese?.trim() ?? "" : ""].filter(Boolean);
    if (!lines.length) return [];
    if (format === "srt") return [`${++index}\n${captionTimestamp(segment.startMs, true)} --> ${captionTimestamp(Math.max(segment.endMs, segment.startMs + 1), true)}\n${lines.join("\n")}`];
    const text = lines.join(format === "md" ? "  \n" : "\n");
    return [options.timestamps ? `[${captionTimestamp(segment.startMs)}] ${text}` : text];
  });
  return { text: blocks.join("\n\n"), pending };
}
