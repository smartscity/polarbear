import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export function exportSvgElementAsSvg(svg: SVGSVGElement, diagramId: string): void {
  void (async () => {
    const selectedPath = await save({
      defaultPath: `${safeDiagramFileBase(diagramId)}.svg`,
      filters: [{ name: "SVG Image", extensions: ["svg"] }],
      title: "Export SVG",
    });
    if (!selectedPath) return;

    const clonedSvg = cloneSvgForExport(svg);
    const svgContent = new XMLSerializer().serializeToString(clonedSvg);
    await invoke("export_svg_file", { path: selectedPath, svgContent });
  })();
}

export function exportSvgElementAsPng(svg: SVGSVGElement, diagramId: string): void {
  void (async () => {
    const selectedPath = await save({
      defaultPath: `${safeDiagramFileBase(diagramId)}.png`,
      filters: [{ name: "PNG Image", extensions: ["png"] }],
      title: "Export PNG",
    });
    if (!selectedPath) return;

    const clonedSvg = cloneSvgForExport(svg);
    const width = Number.parseFloat(clonedSvg.getAttribute("width") || "800") || 800;
    const height = Number.parseFloat(clonedSvg.getAttribute("height") || "600") || 600;

    sanitizeSvgForCanvas(clonedSvg);

    const svgData = new XMLSerializer().serializeToString(clonedSvg);
    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;

    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (!blob) return;
        void (async () => {
          const arrayBuffer = await blob.arrayBuffer();
          const imageBytes = Array.from(new Uint8Array(arrayBuffer));
          await invoke("export_png_file", { path: selectedPath, imageBytes });
        })();
      }, "image/png");
    };

    img.src = svgDataUrl;
  })();
}

export function findRenderedSvg(container: HTMLElement | null): SVGSVGElement | null {
  const svg = container?.querySelector("svg");
  return svg instanceof SVGSVGElement ? svg : null;
}

function safeDiagramFileBase(diagramId: string): string {
  return diagramId.replace(/[^a-z0-9_-]/gi, "_");
}

function cloneSvgForExport(svg: SVGSVGElement): SVGSVGElement {
  const rect = svg.getBoundingClientRect();
  const width = Math.ceil(rect.width) || 800;
  const height = Math.ceil(rect.height) || 600;
  const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
  clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clonedSvg.setAttribute("width", String(width));
  clonedSvg.setAttribute("height", String(height));
  return clonedSvg;
}

function sanitizeSvgForCanvas(svg: SVGSVGElement): void {
  const foreignObjects = svg.querySelectorAll("foreignObject");
  for (const foreignObject of foreignObjects) {
    const textContent = (foreignObject.textContent || "").trim();
    const x = Number.parseFloat(foreignObject.getAttribute("x") || "0");
    const y = Number.parseFloat(foreignObject.getAttribute("y") || "0");
    const width = Number.parseFloat(foreignObject.getAttribute("width") || "100");
    const height = Number.parseFloat(foreignObject.getAttribute("height") || "20");

    const textElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textElement.setAttribute("x", String(x + width / 2));
    textElement.setAttribute("y", String(y + height / 2));
    textElement.setAttribute("text-anchor", "middle");
    textElement.setAttribute("dominant-baseline", "central");
    textElement.setAttribute("font-size", "14");
    textElement.setAttribute("fill", "#ccc");
    textElement.textContent = textContent;

    foreignObject.parentNode?.replaceChild(textElement, foreignObject);
  }
}
