import { renderMermaidSvg } from "../../src/features/diagram/mermaidRenderer";
import { MermaidRenderError } from "../../src/features/diagram/mermaidRenderError";

export async function run(source: string): Promise<{ cases: number; source: string; svg: string }> {
  const unhandled: string[] = [];
  const onError = (event: ErrorEvent) => unhandled.push(event.message);
  const onRejection = (event: PromiseRejectionEvent) => unhandled.push(String(event.reason));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  try {
    const svg = await renderMermaidSvg("native-original", source);
    document.body.innerHTML = svg;
    if (!document.body.textContent?.includes("14:40 落库") || document.querySelectorAll("rect.milestone").length !== 7) throw new Error("Original native SVG mismatch");
    const custom = await renderMermaidSvg("native-custom", "gantt\ndateFormat DD/MM/YYYY HH:mm\nClock: 14:40 :milestone, a, 19/10/2026 14:40, 0m");
    if (!custom.includes("Clock: 14:40")) throw new Error("Custom date/label mismatch");
    for (const invalid of ["gantt\nA :a, after missing, 1d", "gantt\nA :a, 2026-02-30, 1d", "gantt\ntickInterval 1millisecond\nA :a, 2026-10-19, 10d"]) {
      let rejected = false;
      try { await renderMermaidSvg("native-invalid", invalid); }
      catch (error) { if (!(error instanceof MermaidRenderError)) throw error; rejected = true; }
      if (!rejected) throw new Error("Invalid native Gantt was accepted");
    }
    await renderMermaidSvg("native-recovery", source);
    if (unhandled.length) throw new Error(unhandled.join("\n"));
    if (document.body.children.length !== 1) throw new Error("Temporary SVG container leaked");
    return { cases: 6, source, svg };
  } finally {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  }
}
