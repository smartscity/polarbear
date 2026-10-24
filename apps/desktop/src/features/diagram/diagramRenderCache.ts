import { DIAGRAM_CONFIG } from "./diagramConfig";
import { DiagramBusyError, diagramAbortError } from "./diagramRenderQueue";

type PendingRender = { promise: Promise<string>; controller: AbortController; consumers: number; retained: boolean };

/** Deduplicates active renders and bounds retained source/SVG strings per renderer. */
export class DiagramRenderCache {
  private readonly completed = new Map<string, string>();
  private readonly pending = new Map<string, PendingRender>();
  private pendingCodeUnits = 0;
  private codeUnits = 0;

  constructor(private readonly limits: { entries: number; codeUnits: number } = DIAGRAM_CONFIG.cache) {}

  getOrRender(source: string, render: (signal: AbortSignal) => Promise<string>, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) return Promise.reject(diagramAbortError());
    const cached = this.completed.get(source);
    if (cached !== undefined) {
      this.completed.delete(source);
      this.completed.set(source, cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(source);
    if (pending) return this.subscribe(source, pending, signal);
    if (this.pending.size >= DIAGRAM_CONFIG.cache.entries || this.pendingCodeUnits + source.length > DIAGRAM_CONFIG.cache.codeUnits) {
      return Promise.reject(new DiagramBusyError());
    }
    const controller = new AbortController();
    const entry: PendingRender = { controller, consumers: 0, retained: false, promise: Promise.resolve("") };
    const result = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw diagramAbortError();
      return render(controller.signal);
    }).then((svg) => {
      this.removePending(source, entry);
      if (controller.signal.aborted) throw diagramAbortError();
      const size = source.length + svg.length;
      if (size <= this.limits.codeUnits && this.limits.entries > 0) {
        this.completed.set(source, svg);
        this.codeUnits += size;
        while (this.completed.size > this.limits.entries || this.codeUnits > this.limits.codeUnits) {
          const [key, value] = this.completed.entries().next().value!;
          this.completed.delete(key);
          this.codeUnits -= key.length + value.length;
        }
      }
      return svg;
    }, (error: unknown) => {
      this.removePending(source, entry);
      throw error;
    });
    entry.promise = result;
    this.pending.set(source, entry);
    this.pendingCodeUnits += source.length;
    return this.subscribe(source, entry, signal);
  }

  private removePending(source: string, entry: PendingRender): void {
    if (this.pending.get(source) !== entry) return;
    this.pending.delete(source); this.pendingCodeUnits -= source.length;
  }

  private subscribe(source: string, entry: PendingRender, signal?: AbortSignal): Promise<string> {
    if (!signal) { entry.retained = true; return entry.promise; }
    entry.consumers++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        if (finished) return false;
        finished = true; signal.removeEventListener("abort", cancel); entry.consumers--; return true;
      };
      const cancel = () => {
        if (!cleanup()) return;
        if (entry.consumers === 0 && !entry.retained) {
          this.removePending(source, entry); entry.controller.abort();
        }
        reject(diagramAbortError());
      };
      signal.addEventListener("abort", cancel, { once: true });
      entry.promise.then((svg) => { if (cleanup()) resolve(svg); }, (error: unknown) => { if (cleanup()) reject(error); });
    });
  }
}
