import { invoke } from "@tauri-apps/api/core";
import type { LibraryAsset, LibraryEntry, ReaderLibrary } from "./library";

const COMMANDS = {
  list: "plugin:reader|listDocuments",
  import: "plugin:reader|importDocuments",
  read: "plugin:reader|readDocument",
  asset: "plugin:reader|readAsset",
  remove: "plugin:reader|removeCollection",
} as const;

export const nativeLibrary: ReaderLibrary = {
  list: async () => (await invoke<{ entries: LibraryEntry[] }>(COMMANDS.list)).entries,
  read: async ({ collection, path }) => (await invoke<{ content: string }>(COMMANDS.read, { collection, path })).content,
  asset: ({ collection }, path) => invoke<LibraryAsset>(COMMANDS.asset, { collection, path }),
  remove: (collection) => invoke<void>(COMMANDS.remove, { collection }),
};

export async function importNativeDocuments(folder: boolean): Promise<LibraryEntry[]> {
  return (await invoke<{ entries: LibraryEntry[] }>(COMMANDS.import, { folder })).entries;
}
