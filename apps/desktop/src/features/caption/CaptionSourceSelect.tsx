import { useI18n } from "../../shared/i18n/I18nProvider";
import type { CaptionSource } from "./captionAdapter";

export function CaptionSourceSelect({ source, disabled, onChange }: {
  source: CaptionSource;
  disabled?: boolean;
  onChange: (source: CaptionSource) => void;
}) {
  const { t } = useI18n();
  return <label className="caption-source-select">
    <span>{t("caption.source")}</span>
    <select value={source} disabled={disabled} onChange={(event) => {
      const value = event.target.value;
      if (value === "system" || value === "microphone") onChange(value);
    }}>
      <option value="system">{t("caption.system")}</option>
      <option value="microphone">{t("caption.microphone")}</option>
    </select>
  </label>;
}
