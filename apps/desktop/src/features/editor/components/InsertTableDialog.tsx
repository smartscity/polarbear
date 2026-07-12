import { useEffect, useState } from "react";
import { useI18n } from "../../../shared/i18n/I18nProvider";
import { TABLE_UI } from "../table/tableConstants";

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
        <div className="table-create-grid-picker" role="grid" aria-label={t("table.create")}>
          {Array.from({ length: TABLE_UI.sizePickerLimit }, (_, rowIndex) =>
            Array.from({ length: TABLE_UI.sizePickerLimit }, (_, columnIndex) => {
              const nextRows = rowIndex + 1;
              const nextColumns = columnIndex + 1;
              const selected = nextRows <= rows && nextColumns <= columns;
              return (
                <button
                  aria-label={t("table.sizeValue", { columns: nextColumns, rows: nextRows })}
                  aria-selected={selected}
                  className={selected ? "table-create-grid-cell table-create-grid-cell-active" : "table-create-grid-cell"}
                  key={`${nextRows}:${nextColumns}`}
                  onClick={() => {
                    setColumns(nextColumns);
                    setRows(nextRows);
                  }}
                  onMouseEnter={() => {
                    setColumns(nextColumns);
                    setRows(nextRows);
                  }}
                  type="button"
                />
              );
            }),
          )}
        </div>
        <output className="table-create-grid-label" aria-live="polite">
          {t("table.sizeValue", { columns, rows })}
        </output>
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
