import { useI18n } from "../../../shared/i18n/I18nProvider";
import { useDismissOnEscape } from "../../../shared/hooks/useDismissOnEscape";

type ExternalFileChangedDialogProps = {
  path: string;
  reason: "changed" | "deleted";
  onKeepEditing: () => void;
  onReloadFromDisk: () => void;
  onSaveAs: () => void;
};

/**
 * Gives the author an explicit choice when an open, dirty file changes on disk.
 * Keeping the local buffer is always the non-destructive default.
 */
export function ExternalFileChangedDialog({
  path,
  reason,
  onKeepEditing,
  onReloadFromDisk,
  onSaveAs,
}: ExternalFileChangedDialogProps) {
  const { t } = useI18n();
  const isDeleted = reason === "deleted";
  const title = isDeleted
    ? t("dialog.externalFileDeletedTitle")
    : t("dialog.externalFileChangedTitle");
  const description = isDeleted
    ? t("dialog.externalFileDeletedDescription", { path })
    : t("dialog.externalFileChangedDescription", { path });

  useDismissOnEscape(onKeepEditing);

  return (
    <section
      className="create-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="external-file-changed-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onKeepEditing();
        }
      }}
    >
      <section className="create-dialog external-file-changed-dialog">
        <header>
          <h2 id="external-file-changed-title">{title}</h2>
          <p>{description}</p>
        </header>
        <footer>
          <button autoFocus type="button" onClick={onKeepEditing}>
            {t("dialog.keepEditing")}
          </button>
          {isDeleted ? (
            <button type="button" onClick={onSaveAs}>
              {t("dialog.saveAs")}
            </button>
          ) : (
            <button type="button" onClick={onReloadFromDisk}>
              {t("dialog.reloadFromDisk")}
            </button>
          )}
        </footer>
      </section>
    </section>
  );
}
