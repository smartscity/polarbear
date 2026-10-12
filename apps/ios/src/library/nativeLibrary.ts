import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LibraryAsset, LibraryEntry, ReaderLibrary } from "./library";
import type { OpenDocumentBridge, OpenedDocument } from "./openedDocuments";

const COMMANDS = {
  list: "plugin:reader|listDocuments",
  import: "plugin:reader|importDocuments",
  read: "plugin:reader|readDocument",
  asset: "plugin:reader|readAsset",
  remove: "plugin:reader|removeCollection",
  pending: "plugin:reader|pending_open_documents",
  acknowledge: "plugin:reader|acknowledge_open_document",
} as const;

export const nativeOpenDocuments: OpenDocumentBridge = {
  listen: (changed) => listen("reader://document-opened", changed),
  pending: () => invoke<OpenedDocument[]>(COMMANDS.pending),
  acknowledge: (id) => invoke<void>(COMMANDS.acknowledge, { id }),
};

export const nativeLibrary: ReaderLibrary = {
  list: async () => (await invoke<{ entries: LibraryEntry[] }>(COMMANDS.list)).entries,
  read: async ({ collection, path }) => (await invoke<{ content: string }>(COMMANDS.read, { collection, path })).content,
  asset: ({ collection }, path) => invoke<LibraryAsset>(COMMANDS.asset, { collection, path }),
  remove: (collection) => invoke<void>(COMMANDS.remove, { collection }),
};

export async function importNativeDocuments(folder: boolean): Promise<LibraryEntry[]> {
  return (await invoke<{ entries: LibraryEntry[] }>(COMMANDS.import, { folder })).entries;
}
