import { useRef, useState } from "react";
import { useI18n } from "../../../shared/i18n/I18nProvider";
import { useDismissOnEscape } from "../../../shared/hooks/useDismissOnEscape";
import { TABLE_UI } from "../table/tableConstants";

type InsertTableDialogProps = {
  onCancel: () => void;
  onConfirm: (columns: number, rows: number) => void;
};

export function InsertTableDialog({
  onCancel,
  onConfirm,
}: InsertTableDialogProps) {
  const { t } = useI18n();
  const [columns, setColumns] = useState(3);
  const [rows, setRows] = useState(4);
  const [gridFocus, setGridFocus] = useState({ column: 3, row: 4 });
  const gridButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const isValid = columns >= 1 && columns <= 20 && rows >= 1 && rows <= 50;

  const updateGridSelection = (nextRows: number, nextColumns: number, focus = false) => {
    const row = Math.max(1, Math.min(TABLE_UI.sizePickerLimit, nextRows));
    const column = Math.max(1, Math.min(TABLE_UI.sizePickerLimit, nextColumns));
    setRows(nextRows);
    setColumns(nextColumns);
    setGridFocus({ row, column });
    if (focus) {
      window.requestAnimationFrame(() => {
        gridButtonRefs.current.get(`${row}:${column}`)?.focus({ preventScroll: true });
      });
    }
  };

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = gridFocus;
    if (event.key === "Enter") {
      event.preventDefault();
      onConfirm(current.column, current.row);
      return;
    }

    const next = { ...current };
    if (event.key === "ArrowDown") next.row += 1;
    else if (event.key === "ArrowUp") next.row -= 1;
    else if (event.key === "ArrowRight") next.column += 1;
    else if (event.key === "ArrowLeft") next.column -= 1;
    else if (event.key === "Home") next.column = 1;
    else if (event.key === "End") next.column = TABLE_UI.sizePickerLimit;
    else return;

    event.preventDefault();
    updateGridSelection(next.row, next.column, true);
  };

  useDismissOnEscape(onCancel);

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
                    onConfirm(nextColumns, nextRows);
                  }}
                  onFocus={() => setGridFocus({ row: nextRows, column: nextColumns })}
                  onKeyDown={handleGridKeyDown}
                  onMouseEnter={() => {
                    updateGridSelection(nextRows, nextColumns);
                  }}
                  ref={(button) => {
                    const key = `${nextRows}:${nextColumns}`;
                    if (button) gridButtonRefs.current.set(key, button);
                    else gridButtonRefs.current.delete(key);
                  }}
                  role="gridcell"
                  tabIndex={gridFocus.row === nextRows && gridFocus.column === nextColumns ? 0 : -1}
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
