import { useI18n } from "../../shared/i18n/I18nProvider";
import type { CaptionSegment } from "./captionAdapter";
import { memo } from "react";

const FinalEnglish = memo(function FinalEnglish({ segments }: { segments: readonly CaptionSegment[] }) {
  return segments.map((segment, index) => <span key={segment.id}>{index > 0 ? " " : ""}{segment.english.trim()}</span>);
});

/** Present recognition chunks as flowing text without changing durable segment boundaries. */
export const LiveTranscript = memo(function LiveTranscript({ segments, partial, showChinese }: {
  segments: readonly CaptionSegment[];
  partial: string;
  showChinese: boolean;
}) {
  const { t } = useI18n();
  const translated = segments.filter(segment => segment.chinese?.trim());
  const pending = segments.some(segment => segment.translationStatus === "pending");
  const failed = segments.some(segment => segment.translationStatus === "failed");
  return <div className="caption-live-text">
    <p className="caption-live-english" lang="en">
      <FinalEnglish segments={segments} />
      {partial && <span className="caption-partial">{segments.length ? " " : ""}{partial.trim()}</span>}
    </p>
    {showChinese && <>
      {translated.length > 0 && <p lang="zh-CN" className="caption-chinese">
        {translated.map(segment => <span key={segment.id}>{segment.chinese?.trim()}</span>)}
      </p>}
      {(pending || failed) && <p className="caption-live-status" role="status">
        {t(failed ? "caption.translation.failed" : "caption.translation.pending")}
      </p>}
    </>}
  </div>;
});
