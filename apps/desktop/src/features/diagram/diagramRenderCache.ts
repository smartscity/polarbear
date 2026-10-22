import { DIAGRAM_CONFIG } from "./diagramConfig";

/** Deduplicates active renders and bounds retained source/SVG strings per renderer. */
export class DiagramRenderCache {
  private readonly completed = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();
  private codeUnits = 0;

  constructor(private readonly limits: { entries: number; codeUnits: number } = DIAGRAM_CONFIG.cache) {}

  getOrRender(source: string, render: () => Promise<string>): Promise<string> {
    const cached = this.completed.get(source);
    if (cached !== undefined) {
      this.completed.delete(source);
      this.completed.set(source, cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(source);
    if (pending) return pending;
    const result = Promise.resolve().then(render).then((svg) => {
      this.pending.delete(source);
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
      this.pending.delete(source);
      throw error;
    });
    this.pending.set(source, result);
    return result;
  }
}
