import { useState } from "react";
import { useI18n } from "../../../shared/i18n/I18nProvider";
import { useDismissOnEscape } from "../../../shared/hooks/useDismissOnEscape";

const languages = [
  "text",
  "javascript",
  "typescript",
  "java",
  "rust",
  "python",
  "bash",
  "sql",
  "json",
  "yaml",
  "mermaid",
  "plantuml"
];

type InsertCodeFenceDialogProps = {
  onCancel: () => void;
  onConfirm: (language: string) => void;
};

export function InsertCodeFenceDialog({
  onCancel,
  onConfirm
}: InsertCodeFenceDialogProps) {
  const { t } = useI18n();
  const [language, setLanguage] = useState("text");

  useDismissOnEscape(onCancel);

  return (
    <section className="create-dialog-overlay" role="dialog" aria-modal="true">
      <form
        className="create-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(language);
        }}
      >
        <header>
          <h2>{t("editor.insertCodeTitle")}</h2>
          <p>{t("editor.insertCodeDescription")}</p>
        </header>
        <label>
          {t("editor.language")}
          <select
            autoFocus
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {languages.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <footer>
          <button type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="submit">{t("common.insert")}</button>
        </footer>
      </form>
    </section>
  );
}
