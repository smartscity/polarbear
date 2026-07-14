import { save } from "@tauri-apps/plugin-dialog";
import { DIAGRAM_CONFIG } from "./diagramConfig";
import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { invokeTauri } from "../../shared/tauri/invokeTauri";
import { translateCurrent } from "../../shared/i18n/translate";

export type DiagramExportResult = "cancelled" | "exported";

export async function exportSvgElementAsSvg(
  svg: SVGSVGElement,
  diagramId: string,
): Promise<DiagramExportResult> {
  const selectedPath = await save({
    defaultPath: `${safeDiagramFileBase(diagramId)}.svg`,
    filters: [{ name: translateCurrent("diagram.fileTypeSvg"), extensions: ["svg"] }],
    title: translateCurrent("diagram.exportSvg"),
  });
  if (!selectedPath) return "cancelled";

  const clonedSvg = cloneSvgForExport(svg);
  sanitizeSvgForXmlExport(clonedSvg);
  const svgContent = new XMLSerializer().serializeToString(clonedSvg);
  await invokeTauri(TAURI_COMMANDS.exportSvgFile, { path: selectedPath, svgContent });
  return "exported";
}

export async function exportSvgElementAsPng(
  svg: SVGSVGElement,
  diagramId: string,
): Promise<DiagramExportResult> {
  const selectedPath = await save({
    defaultPath: `${safeDiagramFileBase(diagramId)}.png`,
    filters: [{ name: translateCurrent("diagram.fileTypePng"), extensions: ["png"] }],
    title: translateCurrent("diagram.exportPng"),
  });
  if (!selectedPath) return "cancelled";

  const clonedSvg = cloneSvgForExport(svg);
  const width = Number.parseFloat(
    clonedSvg.getAttribute("width") || String(DIAGRAM_CONFIG.export.fallbackWidth),
  ) || DIAGRAM_CONFIG.export.fallbackWidth;
  const height = Number.parseFloat(
    clonedSvg.getAttribute("height") || String(DIAGRAM_CONFIG.export.fallbackHeight),
  ) || DIAGRAM_CONFIG.export.fallbackHeight;

  sanitizeSvgForXmlExport(clonedSvg);
  sanitizeSvgForCanvas(clonedSvg);

  const svgData = new XMLSerializer().serializeToString(clonedSvg);
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;
  const blob = await pngBlobFromSvg(svgDataUrl, width, height);
  const arrayBuffer = await blob.arrayBuffer();
  const imageBytes = Array.from(new Uint8Array(arrayBuffer));
  await invokeTauri(TAURI_COMMANDS.exportPngFile, { path: selectedPath, imageBytes });
  return "exported";
}

export function findRenderedSvg(container: HTMLElement | null): SVGSVGElement | null {
  const svg = container?.querySelector("svg");
  return svg instanceof SVGSVGElement ? svg : null;
}

function pngBlobFromSvg(svgDataUrl: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = DIAGRAM_CONFIG.export.pngScale;
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = height * scale;

        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error(translateCurrent("diagram.exportPngFailed")));
          return;
        }

        context.scale(scale, scale);
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error(translateCurrent("diagram.exportPngFailed")));
            return;
          }
          resolve(blob);
        }, "image/png");
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error(translateCurrent("diagram.exportPngFailed")));
    image.src = svgDataUrl;
  });
}

function safeDiagramFileBase(diagramId: string): string {
  return diagramId.replace(/[^a-z0-9_-]/gi, "_");
}

function cloneSvgForExport(svg: SVGSVGElement): SVGSVGElement {
  const rect = svg.getBoundingClientRect();
  const width = Math.ceil(rect.width) || DIAGRAM_CONFIG.export.fallbackWidth;
  const height = Math.ceil(rect.height) || DIAGRAM_CONFIG.export.fallbackHeight;
  const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
  clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clonedSvg.setAttribute("width", String(width));
  clonedSvg.setAttribute("height", String(height));
  clonedSvg.setAttribute("viewBox", clonedSvg.getAttribute("viewBox") || `0 0 ${width} ${height}`);
  addExportBackground(clonedSvg, width, height);
  addExportContrastStyles(clonedSvg);
  return clonedSvg;
}

function addExportBackground(svg: SVGSVGElement, width: number, height: number): void {
  const viewBox = parseSvgViewBox(svg.getAttribute("viewBox"), width, height);
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("x", String(viewBox.x));
  background.setAttribute("y", String(viewBox.y));
  background.setAttribute("width", String(viewBox.width));
  background.setAttribute("height", String(viewBox.height));
  background.setAttribute("fill", DIAGRAM_CONFIG.export.background);
  svg.insertBefore(background, svg.firstChild);
}

function parseSvgViewBox(
  viewBox: string | null,
  fallbackWidth: number,
  fallbackHeight: number,
): { x: number; y: number; width: number; height: number } {
  const parts = viewBox?.trim().split(/[\s,]+/).map(Number) ?? [];
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    const [x, y, width, height] = parts;
    return { x, y, width, height };
  }
  return { x: 0, y: 0, width: fallbackWidth, height: fallbackHeight };
}

function addExportContrastStyles(svg: SVGSVGElement): void {
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `
    text,
    tspan,
    .label,
    .nodeLabel,
    .edgeLabel,
    .entityLabel {
      color: #111827 !important;
      fill: #111827 !important;
    }

    .entityBox,
    .node rect,
    .node polygon,
    .node circle,
    .node ellipse {
      fill: #ffffff !important;
      stroke: #475569 !important;
    }

    .attributeBoxOdd {
      fill: #ffffff !important;
      stroke: #cbd5e1 !important;
    }

    .attributeBoxEven {
      fill: #f8fafc !important;
      stroke: #cbd5e1 !important;
    }

    .relationshipLine,
    .edgePath path,
    path.relation,
    line {
      stroke: #475569 !important;
    }

    marker path,
    marker polygon {
      fill: #475569 !important;
      stroke: #475569 !important;
    }
  `;
  svg.append(style);
}

function sanitizeSvgForXmlExport(svg: SVGSVGElement): void {
  const walker = document.createTreeWalker(svg, NodeFilter.SHOW_COMMENT);
  const comments: Comment[] = [];
  let node = walker.nextNode();
  while (node) {
    comments.push(node as Comment);
    node = walker.nextNode();
  }

  for (const comment of comments) {
    comment.remove();
  }
}

function sanitizeSvgForCanvas(svg: SVGSVGElement): void {
  const foreignObjects = svg.querySelectorAll("foreignObject");
  for (const foreignObject of foreignObjects) {
    const x = Number.parseFloat(foreignObject.getAttribute("x") || "0");
    const y = Number.parseFloat(foreignObject.getAttribute("y") || "0");
    const width = Number.parseFloat(foreignObject.getAttribute("width") || "100");
    const height = Number.parseFloat(foreignObject.getAttribute("height") || "20");

    const lines = extractLinesFromForeignObject(foreignObject);
    const centerX = x + width / 2;
    const lineHeight = 18;
    const totalTextHeight = lines.length * lineHeight;
    const startY = y + (height - totalTextHeight) / 2 + lineHeight * 0.75;

    const textElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textElement.setAttribute("text-anchor", "middle");
    textElement.setAttribute("font-size", "14");
    textElement.setAttribute("fill", "#111827");

    for (let i = 0; i < lines.length; i++) {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("x", String(centerX));
      tspan.setAttribute("y", String(startY + i * lineHeight));
      tspan.textContent = lines[i];
      textElement.appendChild(tspan);
    }

    foreignObject.parentNode?.replaceChild(textElement, foreignObject);
  }
}

function extractLinesFromForeignObject(fo: Element): string[] {
  const html = fo.innerHTML;
  if (!html.trim()) {
    const text = (fo.textContent || "").trim();
    return text ? [text] : [""];
  }

  const normalized = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  const decoded = normalized
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  const lines = decoded.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length > 0 ? lines : [""];
}
