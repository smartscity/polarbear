import { useEffect, useMemo, useRef, useState } from "react";
import { APP_EVENTS } from "../../shared/events/appEvents";
import { STORAGE_KEYS } from "../../shared/constants/storageKeys";
import { useEventCallback } from "../../shared/hooks/useEventCallback";
import { useI18n } from "../../shared/i18n/I18nProvider";
import type { DocumentOpenResult } from "./documentNavigation";
import { recentDocumentStore, type RecentDocument } from "./recentDocuments";
import { fileNameOf } from "./workspacePaths";
import { showRecentDocumentUnavailable } from "./tauriWorkspaceAdapter";

export type RecentDocumentMenuState = {
  entries: RecentDocument[];
  busy: boolean;
  open: (path: string) => void;
  clear: () => void;
};

/** Projects the existing persisted history into the menu; the session still owns opening. */
export function useRecentDocumentMenu(
  onOpen: (path: string) => Promise<DocumentOpenResult>,
  onStatus: (message: string) => void,
): RecentDocumentMenuState {
  const { t } = useI18n();
  const [entries, setEntries] = useState<RecentDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);
  const mounted = useRef(false);
  const storageFailed = useEventCallback(() => onStatus(t("recent.storageFailed")));
  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      try { setEntries(recentDocumentStore().read()); }
      catch { storageFailed(); }
    };
    const storage = (event: StorageEvent) => {
      if (!event.key || event.key === STORAGE_KEYS.recentDocuments) refresh();
    };
    window.addEventListener(APP_EVENTS.recentDocumentsChanged, refresh);
    window.addEventListener("storage", storage);
    refresh();
    return () => {
      mounted.current = false;
      window.removeEventListener(APP_EVENTS.recentDocumentsChanged, refresh);
      window.removeEventListener("storage", storage);
    };
  }, [storageFailed]);

  const open = useEventCallback((path: string) => {
    if (!mounted.current || opening.current) return;
    try {
      // A click queued before Clear must not resurrect a removed history entry.
      if (!recentDocumentStore().read().some((entry) => entry.path === path)) return;
    } catch { storageFailed(); return; }
    opening.current = true;
    setBusy(true);
    void onOpen(path).then(async (result) => {
      if (result === false && mounted.current) await showRecentDocumentUnavailable(fileNameOf(path));
    }).catch(() => {
      if (mounted.current) onStatus(t("recent.unavailable", { name: fileNameOf(path) }));
    }).finally(() => {
      opening.current = false;
      if (mounted.current) setBusy(false);
    });
  });
  const clear = useEventCallback(() => {
    if (!mounted.current || opening.current) return;
    try { recentDocumentStore().clear(); }
    catch { storageFailed(); }
  });
  return useMemo(() => ({ entries, busy, open, clear }), [entries, busy, open, clear]);
}
