import mermaid from "mermaid";
import { mermaidDiagramConfig } from "./mermaidDiagramConfig";
import { sanitizeDiagramSvg } from "./sanitizeDiagramSvg";
import { DiagramRenderQueue } from "./diagramRenderQueue";
import { DIAGRAM_CONFIG } from "./diagramConfig";
import { prepareGanttSource } from "./ganttSourceAdapter";
import { MermaidRenderError, wrapMermaidRenderError } from "./mermaidRenderError";

const renderQueue = new DiagramRenderQueue(DIAGRAM_CONFIG.scheduling);

let isMermaidInitialized = false;
let renderSequence = 0;

function initializeMermaidRenderer(): void {
  if (isMermaidInitialized) {
    return;
  }

  mermaid.initialize({
    ...mermaidDiagramConfig,
  });
  isMermaidInitialized = true;
}

export async function validateMermaidSource(source: string): Promise<boolean> {
  return renderQueue.run(source, async () => {
    initializeMermaidRenderer();
    try {
      return Boolean(await mermaid.parse(prepareGanttSource(source), { suppressErrors: true }));
    } catch (error) {
      if (error instanceof MermaidRenderError) return false;
      throw wrapMermaidRenderError(error);
    }
  });
}

export async function renderMermaidSvg(
  diagramId: string,
  source: string,
  signal?: AbortSignal,
): Promise<string> {
  return renderQueue.run(source, async () => {
    initializeMermaidRenderer();
    const prepared = prepareGanttSource(source);
    // Own the temporary DOM even if Mermaid fails during parsing, layout, or SVG serialization.
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:100%";
    document.body.append(container);
    try {
      const result = await mermaid.render(`${diagramId}-${++renderSequence}`, prepared, container);
      return sanitizeDiagramSvg(result.svg);
    } catch (error) {
      throw wrapMermaidRenderError(error);
    } finally {
      container.remove();
    }
  }, signal);
}
