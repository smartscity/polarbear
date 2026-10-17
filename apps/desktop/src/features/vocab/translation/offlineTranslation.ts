import { MAX_SENTENCE_LENGTH } from "../readingSelection";
import { TranslationError } from "../../../shared/translation/translationError";

interface TranslationEngine {
  translate(text: string): Promise<string>;
  dispose(reason?: unknown): void;
}

const REQUEST_TIMEOUT_MS = 60_000;
const IDLE_RELEASE_MS = 90_000;

/** A reading window has one current selection, not an unbounded translation queue. */
export class OfflineTranslation {
  private engine: TranslationEngine | undefined;
  private cancel: (() => void) | undefined;
  private idle: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly createEngine: () => Promise<TranslationEngine>) {}

  translate(text: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!text.trim() || text.length > MAX_SENTENCE_LENGTH || text.includes("\0")) {
      return Promise.reject(new TranslationError("translationFailed"));
    }
    this.cancel?.();
    clearTimeout(this.idle);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown, result?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        this.cancel = undefined;
        if (error) {
          this.engine?.dispose(error);
          this.engine = undefined;
          reject(error);
        } else {
          this.idle = setTimeout(() => this.dispose(), IDLE_RELEASE_MS);
          resolve(result!);
        }
      };
      const abort = () => finish(new DOMException("Cancelled", "AbortError"));
      this.cancel = abort;
      signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => finish(new TranslationError("timeout")), REQUEST_TIMEOUT_MS);
      void (async () => {
        const engine = this.engine ?? await this.createEngine();
        if (settled) { engine.dispose(); return; }
        this.engine = engine;
        finish(undefined, await engine.translate(text));
      })().catch((error: unknown) => finish(error instanceof TranslationError ? error : new TranslationError("translationFailed", { cause: error })));
    });
  }

  dispose() {
    this.cancel?.();
    clearTimeout(this.idle);
    this.engine?.dispose();
    this.engine = undefined;
  }
}

const readingTranslator = new OfflineTranslation(async () => {
  const { BergamotWorker } = await import("../../../shared/translation/bergamotWorker");
  return new BergamotWorker();
});

export const translateReadingLocal = (text: string, signal?: AbortSignal) => readingTranslator.translate(text, signal);
if (typeof window !== "undefined") window.addEventListener("pagehide", () => readingTranslator.dispose());
