import { loadBundledModel, MODEL_PAIR } from "./bundledModel";
import { TranslationError } from "./translationError";

/** Owns one upstream Bergamot worker, including initialization failure and early cancellation. */
export class BergamotWorker {
  private readonly worker = new Worker("/translation-runtime/translator-worker.js");
  private readonly controller = new AbortController();
  private readonly pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: unknown) => void }>();
  private serial = 0;
  private closed = false;
  private readonly ready: Promise<void>;

  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<{ id: number; result: unknown; error?: unknown }>) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (data.error !== undefined) request.reject(new TranslationError("translationFailed"));
      else request.resolve(data.result);
    };
    this.worker.onerror = () => this.dispose(new TranslationError("translationFailed"));
    this.worker.onmessageerror = () => this.dispose(new TranslationError("translationFailed"));
    this.ready = this.initialize();
    // The owner may cancel before translate() awaits initialization.
    void this.ready.catch(() => undefined);
  }

  private async initialize() {
    const [, model] = await Promise.all([
      this.call("initialize", [{ cacheSize: 0, useNativeIntGemm: false }]),
      loadBundledModel(this.controller.signal),
    ]);
    await this.call("loadTranslationModel", [MODEL_PAIR, model], [model.model, model.shortlist, ...model.vocabs]);
  }

  async translate(text: string): Promise<string> {
    await this.ready;
    const result = await this.call("translate", [{ models: [MODEL_PAIR], texts: [{ text, html: false, qualityScores: false }] }]);
    if (!Array.isArray(result) || typeof result[0]?.target?.text !== "string" || !result[0].target.text.trim()) {
      throw new TranslationError("translationFailed");
    }
    return result[0].target.text;
  }

  private call(name: string, args: unknown[], transfer: Transferable[] = []): Promise<unknown> {
    if (this.closed) return Promise.reject(new DOMException("Cancelled", "AbortError"));
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ id, name, args }, transfer); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  dispose(reason: unknown = new DOMException("Cancelled", "AbortError")) {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort(reason);
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(reason);
    this.pending.clear();
  }
}
