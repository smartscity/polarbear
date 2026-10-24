import { STORAGE_KEYS } from "../../shared/constants/storageKeys";
import { APP_EVENTS } from "../../shared/events/appEvents";

export const RECENT_DOCUMENT_LIMIT = 20;
export type RecentDocument = { path: string; openedAt: number };

export function documentHistoryPath(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot.replace(/[\\/]+$/, "")}/${relativePath}`.replaceAll("\\", "/");
}

export function parseRecentDocuments(value: unknown): RecentDocument[] {
  if (!Array.isArray(value)) return [];
  const entries = new Map<string, RecentDocument>();
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.path !== "string"
      || !/^(\/|[a-z]:[\\/])/i.test(item.path) || !/\.(md|markdown)$/i.test(item.path)
      || typeof item.openedAt !== "number" || !Number.isFinite(item.openedAt) || item.openedAt < 0 || item.openedAt > 8.64e15) continue;
    const path = item.path.replaceAll("\\", "/");
    if ((entries.get(path)?.openedAt ?? -1) < item.openedAt) entries.set(path, { path, openedAt: item.openedAt });
  }
  return [...entries.values()].sort((a, b) => b.openedAt - a.openedAt || a.path.localeCompare(b.path)).slice(0, RECENT_DOCUMENT_LIMIT);
}

// Store metadata only. Native document access remains the authority for permissions.
export class RecentDocumentStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">, private readonly changed: () => void = () => {}) {}

  read(): RecentDocument[] {
    const serialized = this.storage.getItem(STORAGE_KEYS.recentDocuments);
    if (!serialized) return [];
    try { return parseRecentDocuments(JSON.parse(serialized)); } catch { return []; }
  }

  record(path: string, openedAt = Date.now()): void {
    this.write([...this.read(), { path, openedAt }]);
  }

  remap(root: string, from: string, to: string): void {
    const source = documentHistoryPath(root, from), destination = documentHistoryPath(root, to);
    this.write(this.read().map((entry) => entry.path === source || entry.path.startsWith(`${source}/`)
      ? { ...entry, path: destination + entry.path.slice(source.length) } : entry));
  }

  remove(path: string): void { this.write(this.read().filter((entry) => entry.path !== path)); }
  clear(): void { this.write([]); }

  private write(entries: RecentDocument[]): void {
    this.storage.setItem(STORAGE_KEYS.recentDocuments, JSON.stringify(parseRecentDocuments(entries)));
    this.changed();
  }
}

export function recentDocumentStore(): RecentDocumentStore {
  return new RecentDocumentStore(window.localStorage, () => window.dispatchEvent(new Event(APP_EVENTS.recentDocumentsChanged)));
}
