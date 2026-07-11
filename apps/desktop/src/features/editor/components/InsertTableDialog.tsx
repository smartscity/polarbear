import { useEffect, useState } from "react";
import { useI18n } from "../../../shared/i18n/I18nProvider";

type InsertTableDialogProps = {
  onCancel: () => void;
  onConfirm: (columns: number, rows: number) => void;
};

export function InsertTableDialog({
  onCancel,
  onConfirm
}: InsertTableDialogProps) {
  const { t } = useI18n();
  const [columns, setColumns] = useState(3);
  const [rows, setRows] = useState(4);
  const isValid = columns >= 1 && columns <= 20 && rows >= 1 && rows <= 50;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <section className="create-dialog-overlay" role="dialog" aria-modal="true">
      <form
        className="create-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (isValid) {
            onConfirm(columns, rows);
          }
        }}
      >
        <header>
          <h2>{t("editor.insertTableTitle")}</h2>
          <p>{t("editor.insertTableDescription")}</p>
        </header>
        <label>
          {t("editor.columns")}
          <input
            autoFocus
            max={20}
            min={1}
            type="number"
            value={columns}
            onChange={(event) => setColumns(Number(event.target.value))}
          />
        </label>
        <label>
          {t("editor.rows")}
          <input
            max={50}
            min={1}
            type="number"
            value={rows}
            onChange={(event) => setRows(Number(event.target.value))}
          />
        </label>
        <footer>
          <button type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={!isValid}>
            {t("common.ok")}
          </button>
        </footer>
      </form>
    </section>
  );
}
