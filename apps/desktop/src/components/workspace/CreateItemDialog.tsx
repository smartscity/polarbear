import { useEffect, useState } from "react";

export type CreateItemType = "file" | "folder";

type CreateItemDialogProps = {
  defaultName: string;
  itemType: CreateItemType;
  onCancel: () => void;
  onConfirm: (name: string) => void;
};

export function CreateItemDialog({
  defaultName,
  itemType,
  onCancel,
  onConfirm
}: CreateItemDialogProps) {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    setName(defaultName);
  }, [defaultName]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const title =
    itemType === "file" ? "Create Markdown file" : "Create folder";
  const description =
    itemType === "file"
      ? "Create a .md file in the current workspace."
      : "Create a directory in the current workspace.";

  return (
    <section
      className="create-dialog-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <form
        className="create-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(name);
        }}
      >
        <header>
          <h2>{title}</h2>
          <p>{description}</p>
        </header>
        <label>
          Name
          <input
            autoFocus
            placeholder={itemType === "file" ? "notes.md" : "docs"}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <footer>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">Create</button>
        </footer>
      </form>
    </section>
  );
}
