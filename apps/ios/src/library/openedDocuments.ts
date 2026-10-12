import type { LibraryEntry } from "./library";

export interface OpenedDocument {
  id: number;
  entries: LibraryEntry[];
  error: string | null;
}

export interface OpenDocumentBridge {
  listen: (changed: () => void) => Promise<() => void>;
  pending: () => Promise<OpenedDocument[]>;
  acknowledge: (id: number) => Promise<void>;
}

/** Subscribe before reading the inbox; notifications are hints, not the source of truth. */
export function subscribeToOpenedDocuments(
  bridge: OpenDocumentBridge,
  consume: (item: OpenedDocument, active: () => boolean) => Promise<void>,
  report: (error: unknown) => void,
) {
  let active = true;
  let running = false;
  let changed = false;
  let unlisten: (() => void) | undefined;

  const drain = async () => {
    changed = true;
    if (running || !active) return;
    running = true;
    try {
      while (active && changed) {
        changed = false;
        const items = await bridge.pending();
        for (const item of items) {
          if (!active) return;
          await consume(item, () => active);
          if (!active) return;
          await bridge.acknowledge(item.id);
        }
      }
    } catch (error) { if (active) report(error); }
    finally { running = false; }
  };
  const refresh = () => { void drain(); };
  void bridge.listen(refresh).then((stop) => {
    if (!active) { stop(); return; }
    unlisten = stop;
    refresh();
  }).catch((error: unknown) => { if (active) report(error); });

  return { refresh, stop: () => { active = false; unlisten?.(); } };
}
