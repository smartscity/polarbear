import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ReadingCapture } from "./readingModel";

const COMMANDS = {
  translate: "plugin:reader|translateText", cancel: "plugin:reader|cancelTranslation",
  speak: "plugin:reader|speakText", stop: "plugin:reader|stopSpeech", dictionary: "plugin:reader|showDictionary",
  list: "plugin:reader|listCaptures", save: "plugin:reader|saveCapture", share: "plugin:reader|shareCaptures",
  remove: "plugin:reader|removeCapture",
} as const;

function native<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : Promise.reject(new Error("nativeOnly"));
}
export const readingAdapter = {
  translate: (text: string) => native<{ text: string }>(COMMANDS.translate, { text }),
  cancel: () => native<void>(COMMANDS.cancel),
  speak: (text: string) => native<void>(COMMANDS.speak, { text }),
  stop: () => native<void>(COMMANDS.stop),
  dictionary: (text: string) => native<void>(COMMANDS.dictionary, { text }),
  list: () => native<ReadingCapture[]>(COMMANDS.list),
  save: (capture: ReadingCapture) => native<ReadingCapture>(COMMANDS.save, { capture }),
  share: () => native<{ shared: boolean }>(COMMANDS.share),
  remove: (requestId: string) => native<void>(COMMANDS.remove, { requestId }),
};

export function readingErrorKey(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  const known = ["nativeOnly", "unsupportedSystem", "languagePackMissing", "unsupportedLanguage", "translationFailed", "timeout", "speechUnavailable", "dictionaryUnavailable", "queueFull", "storageError", "invalidTerm", "busy"];
  return `reader.reading.error.${known.includes(code) ? code : "unavailable"}`;
}
