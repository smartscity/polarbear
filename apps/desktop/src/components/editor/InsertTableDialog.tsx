import { useEffect, useState } from "react";

type InsertTableDialogProps = {
  onCancel: () => void;
  onConfirm: (columns: number, rows: number) => void;
};

export function InsertTableDialog({
  onCancel,
  onConfirm
}: InsertTableDialogProps) {
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
          <h2>Insert Table</h2>
          <p>Rows are body rows and do not include the header.</p>
        </header>
        <label>
          Columns
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
          Rows
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
            Cancel
          </button>
          <button type="submit" disabled={!isValid}>
            OK
          </button>
        </footer>
      </form>
    </section>
  );
}
