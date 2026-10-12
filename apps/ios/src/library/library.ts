export type LibraryEntry = { collection: string; path: string; importedAt: number };
export type LibraryAsset = { mime: string; base64: string };
export interface ReaderLibrary {
  list(): Promise<LibraryEntry[]>;
  read(entry: LibraryEntry): Promise<string>;
  asset(entry: LibraryEntry, path: string): Promise<LibraryAsset>;
  remove(collection: string): Promise<void>;
}
export const READER_LIMITS = {
  documentBytes: 5 * 1024 * 1024,
  assetBytes: 20 * 1024 * 1024,
  collectionBytes: 100 * 1024 * 1024,
  files: 2000,
  diagramCharacters: 30_000,
} as const;
export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml",
};
export const entryId = (entry: LibraryEntry) => `${entry.collection}/${entry.path}`;

export function readerErrorKey(error: unknown): string {
  const code = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
  const known = ["invalidPath", "unsupportedFile", "tooLarge", "emptyImport", "invalidEncoding", "unavailable", "busy"];
  return `reader.error.${known.includes(code) ? code : "unavailable"}`;
}
