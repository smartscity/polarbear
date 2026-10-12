import { isMarkdownPath } from "@polarbear/reader-core/paths";
import { IMAGE_TYPES, READER_LIMITS, type LibraryEntry, type ReaderLibrary } from "./library";

type Snapshot = { id: string; entries: LibraryEntry[]; files: Record<string, Blob> };
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("polarbear-reader", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("collections", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("collections", mode);
    const request = action(tx.objectStore("collections"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function snapshot(id: string): Promise<Snapshot> {
  const value = await transaction<Snapshot | undefined>("readonly", (store) => store.get(id));
  if (!value) throw new Error("unavailable");
  return value;
}
export const browserLibrary: ReaderLibrary = {
  list: async () => (await transaction<Snapshot[]>("readonly", (store) => store.getAll())).flatMap((s) => s.entries),
  read: async ({ collection, path }) => {
    const blob = (await snapshot(collection)).files[path];
    if (!blob || !isMarkdownPath(path)) throw new Error("unavailable");
    return new TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer());
  },
  asset: async ({ collection }, path) => {
    const blob = (await snapshot(collection)).files[path];
    const mime = IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];
    if (!blob || !mime) throw new Error("unavailable");
    const data = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
    return { mime, base64: btoa(binary) };
  },
  remove: async (collection) => { await transaction("readwrite", (store) => store.delete(collection)); },
};

export async function importBrowserDocuments(selected: File[]): Promise<LibraryEntry[]> {
  if (selected.length > READER_LIMITS.files) throw new Error("tooLarge");
  const id = crypto.randomUUID();
  const entries: LibraryEntry[] = [];
  const files: Record<string, Blob> = Object.create(null);
  let total = 0;
  for (const file of selected) {
    const path = file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
    if (!path || path.split("/").some((part) => part === ".." || part.startsWith("."))) continue;
    const markdown = isMarkdownPath(path);
    const mime = IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];
    if (!markdown && !mime) continue;
    total += file.size;
    if (file.size > (markdown ? READER_LIMITS.documentBytes : READER_LIMITS.assetBytes) || total > READER_LIMITS.collectionBytes) throw new Error("tooLarge");
    const bytes = await file.arrayBuffer();
    if (markdown) {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new Error("invalidEncoding"); }
      entries.push({ collection: id, path, importedAt: Date.now() });
    }
    // File objects can retain a dependency on the selected OS file. Persist owned bytes.
    files[path] = new Blob([bytes], { type: mime ?? "text/markdown" });
  }
  if (!entries.length) throw new Error("emptyImport");
  await transaction("readwrite", (store) => store.add({ id, files, entries } satisfies Snapshot));
  return entries;
}
