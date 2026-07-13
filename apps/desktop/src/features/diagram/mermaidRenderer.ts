import mermaid from "mermaid";
import { mermaidDiagramConfig } from "./mermaidDiagramConfig";
import { sanitizeDiagramSvg } from "./sanitizeDiagramSvg";

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

export async function renderMermaidSvg(
  diagramId: string,
  source: string,
): Promise<string> {
  initializeMermaidRenderer();
  const result = await mermaid.render(diagramId, source);
  return sanitizeDiagramSvg(result.svg);
}
