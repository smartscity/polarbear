import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { invokeTauri, TauriCommandError } from "../../shared/tauri/invokeTauri";

export type VocabEntry = {
  senseUid: string;
  lemma: string;
  ipa: string;
  partOfSpeech: string;
  zhGloss: string;
  inMyVocabulary: boolean;
};

export type ReadingCapture = {
  requestId: string;
  selectedText: string;
  senseUid: string | null;
  sentence: string;
  title: string;
  filePath: string | null;
  heading: string;
  line: number | null;
};

export async function lookupVocab(query: string): Promise<VocabEntry[]> {
  const result = await invokeTauri<unknown>(TAURI_COMMANDS.vocabRequest, { operation: { method: "lookup", query } });
  if (!Array.isArray(result) || !result.every(isVocabEntry)) throw new Error("Invalid Vocab lookup response");
  return result;
}

function isVocabEntry(value: unknown): value is VocabEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return ["senseUid", "lemma", "ipa", "partOfSpeech", "zhGloss"].every((key) => typeof entry[key] === "string")
    && typeof entry.inMyVocabulary === "boolean";
}

export const saveVocab = (capture: ReadingCapture) =>
  invokeTauri<{ id: string; capture: ReadingCapture }>(TAURI_COMMANDS.vocabRequest,
    { operation: { method: "save", capture } });

export const speakVocab = (text: string) =>
  invokeTauri(TAURI_COMMANDS.vocabRequest, { operation: { method: "speak", text } });

export const translateReadingLocal = (text: string) =>
  invokeTauri<string>(TAURI_COMMANDS.translateReadingLocal, { text });

export function vocabErrorKey(error: unknown): string {
  const code = error instanceof TauriCommandError ? error.code : "operationFailed";
  return ["notInstalled", "unavailable", "unsupportedPlatform", "unsupportedVersion", "timeout", "unsafeEndpoint"].includes(code)
    ? `vocab.error.${code}` : "vocab.error.operationFailed";
}
