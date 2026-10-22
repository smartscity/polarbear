import { useEffect, useState } from "react";
import { FileText, Trash2, X } from "lucide-react";
import { APP_EVENTS } from "../../../shared/events/appEvents";
import { STORAGE_KEYS } from "../../../shared/constants/storageKeys";
import { useI18n } from "../../../shared/i18n/I18nProvider";
import { fileNameOf } from "../workspacePaths";
import { recentDocumentStore, type RecentDocument } from "../recentDocuments";

export function RecentDocuments({ onOpen }: { onOpen: (path: string) => Promise<boolean> }) {
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<RecentDocument[]>([]);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => {
      try { setEntries(recentDocumentStore().read()); }
      catch { setError(t("recent.storageFailed")); }
    };
    const storage = (event: StorageEvent) => { if (!event.key || event.key === STORAGE_KEYS.recentDocuments) refresh(); };
    window.addEventListener(APP_EVENTS.recentDocumentsChanged, refresh);
    window.addEventListener("storage", storage);
    refresh();
    return () => {
      window.removeEventListener(APP_EVENTS.recentDocumentsChanged, refresh);
      window.removeEventListener("storage", storage);
    };
  }, [t]);
  const mutate = (operation: () => void) => {
    try { operation(); setError(""); } catch { setError(t("recent.storageFailed")); }
  };
  const open = async (path: string) => {
    setOpening(path); setError("");
    try { if (!await onOpen(path)) setError(t("recent.unavailable", { name: fileNameOf(path) })); }
    catch { setError(t("recent.unavailable", { name: fileNameOf(path) })); }
    finally { setOpening(null); }
  };
  return <details className="recent-documents" open>
    <summary>{t("recent.title")}</summary>
    {entries.length ? <>
      <button type="button" className="recent-clear" onClick={() => mutate(() => recentDocumentStore().clear())}>
        <Trash2 size={14} aria-hidden="true" />{t("recent.clear")}
      </button>
      <ul aria-label={t("recent.title")}>
        {entries.map((entry) => <li key={entry.path}>
          <button type="button" className="recent-open" title={entry.path} disabled={opening !== null}
            onClick={() => void open(entry.path)}>
            <FileText size={16} aria-hidden="true" />
            <span><strong>{fileNameOf(entry.path)}</strong><small>{entry.path}</small>
              <time dateTime={new Date(entry.openedAt).toISOString()}>{new Date(entry.openedAt).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" })}</time>
            </span>
          </button>
          <button type="button" className="recent-remove" title={t("recent.remove", { name: fileNameOf(entry.path) })}
            aria-label={t("recent.remove", { name: fileNameOf(entry.path) })} onClick={() => mutate(() => recentDocumentStore().remove(entry.path))}><X size={14} /></button>
        </li>)}
      </ul>
    </> : <p>{t("recent.empty")}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
