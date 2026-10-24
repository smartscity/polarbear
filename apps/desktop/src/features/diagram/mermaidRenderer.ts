import mermaid from "mermaid";
import { mermaidDiagramConfig } from "./mermaidDiagramConfig";
import { sanitizeDiagramSvg } from "./sanitizeDiagramSvg";
import { DiagramRenderQueue } from "./diagramRenderQueue";
import { DIAGRAM_CONFIG } from "./diagramConfig";

const renderQueue = new DiagramRenderQueue(DIAGRAM_CONFIG.scheduling);

let isMermaidInitialized = false;

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
    return Boolean(await mermaid.parse(source, { suppressErrors: true }));
  });
}

export async function renderMermaidSvg(
  diagramId: string,
  source: string,
  signal?: AbortSignal,
): Promise<string> {
  return renderQueue.run(source, async () => {
    initializeMermaidRenderer();
    const result = await mermaid.render(diagramId, source);
    return sanitizeDiagramSvg(result.svg);
  }, signal);
}
