import { useEffect, useState } from "react";

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
  const [language, setLanguage] = useState("text");

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
          onConfirm(language);
        }}
      >
        <header>
          <h2>Insert Code Fence</h2>
          <p>Choose a language for the fenced code block.</p>
        </header>
        <label>
          Language
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
            Cancel
          </button>
          <button type="submit">Insert</button>
        </footer>
      </form>
    </section>
  );
}
