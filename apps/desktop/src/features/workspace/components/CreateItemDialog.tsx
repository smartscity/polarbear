import { useEffect, useState } from "react";
import { useI18n } from "../../../shared/i18n/I18nProvider";

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
  const { t } = useI18n();
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
    itemType === "file" ? t("create.fileTitle") : t("create.folderTitle");
  const description =
    itemType === "file"
      ? t("create.fileDescription")
      : t("create.folderDescription");

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
          {t("create.name")}
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
            {t("common.cancel")}
          </button>
          <button type="submit">{t("common.create")}</button>
        </footer>
      </form>
    </section>
  );
}
