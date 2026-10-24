export class DiagramBusyError extends Error {
  constructor() { super("diagram.renderBusy"); this.name = "DiagramBusyError"; }
}

export function diagramAbortError(): DOMException { return new DOMException("Diagram request cancelled", "AbortError"); }

/** Admission before renderer-internal queues. Aborting a consumer never frees a running engine slot early. */
export class DiagramRenderQueue {
  private active = 0;
  private retained = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limits: { concurrency: number; pending: number; codeUnits: number }) {}

  run<T>(source: string, render: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(diagramAbortError());
    if ((this.active >= this.limits.concurrency && this.waiting.length >= this.limits.pending)
      || this.retained + source.length > this.limits.codeUnits) return Promise.reject(new DiagramBusyError());
    this.retained += source.length;
    return new Promise<T>((resolve, reject) => {
      let started = false;
      const cancel = () => {
        if (!started) {
          const index = this.waiting.indexOf(start);
          if (index >= 0) { this.waiting.splice(index, 1); this.retained -= source.length; }
          signal?.removeEventListener("abort", cancel);
        }
        reject(diagramAbortError());
      };
      const finish = () => {
        signal?.removeEventListener("abort", cancel);
        this.active--; this.retained -= source.length;
        this.waiting.shift()?.();
      };
      const start = () => {
        started = true; this.active++;
        Promise.resolve().then(() => {
          if (signal?.aborted) throw diagramAbortError();
          return render();
        }).then((value) => { finish(); resolve(value); }, (error: unknown) => { finish(); reject(error); });
      };
      signal?.addEventListener("abort", cancel, { once: true });
      if (this.active < this.limits.concurrency) start();
      else this.waiting.push(start);
    });
  }
}
