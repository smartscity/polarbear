import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import {
  exportSvgElementAsSvg,
  findRenderedSvg,
} from "../editor/diagramExport";

export type MermaidBlockProps = {
  source: string;
  diagramId: string;
};

let mermaidInitialized = false;

function initializeMermaid(): void {
  if (mermaidInitialized) {
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "dark"
  });
  mermaidInitialized = true;
}

export function MermaidBlock({ source, diagramId }: MermaidBlockProps) {
  const renderVersionRef = useRef(0);
  const renderTargetRef = useRef<HTMLDivElement | null>(null);
  const [svgContent, setSvgContent] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    initializeMermaid();
    renderVersionRef.current += 1;
    const renderVersion = renderVersionRef.current;

    setSvgContent("");
    setRenderError(null);

    mermaid
      .render(`${diagramId}-${renderVersion}`, source)
      .then(({ svg }) => {
        if (renderVersionRef.current === renderVersion) {
          setSvgContent(svg);
        }
      })
      .catch((error: unknown) => {
        if (renderVersionRef.current === renderVersion) {
          setRenderError(error instanceof Error ? error.message : String(error));
        }
      });
  }, [diagramId, source]);

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopyStatus("Copied");
      window.setTimeout(() => setCopyStatus(""), 1400);
    } catch (error) {
      setCopyStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const exportSvg = () => {
    const svg = findRenderedSvg(renderTargetRef.current);
    if (svg) exportSvgElementAsSvg(svg, diagramId);
  };

  if (renderError) {
    return (
      <figure className="mermaid-card mermaid-card-error">
        <figcaption>Mermaid render failed</figcaption>
        <pre>{renderError}</pre>
      </figure>
    );
  }

  return (
    <figure className="mermaid-card">
      <figcaption>
        Mermaid Diagram
        {copyStatus ? <span>{copyStatus}</span> : null}
      </figcaption>
      <div className="mermaid-block-toolbar">
        <button type="button" aria-label="Copy source" title="Copy Source" onClick={() => void copySource()}>
          <CopyIcon />
        </button>
        <button type="button" aria-label="Export SVG" title="Export SVG" disabled={!svgContent} onClick={exportSvg}>
          <ExportIcon />
        </button>
      </div>
      <div
        className="mermaid-render-target"
        ref={renderTargetRef}
      >
        {svgContent ? (
          <span dangerouslySetInnerHTML={{ __html: svgContent }} />
        ) : (
          <span className="mermaid-loading">Rendering Mermaid diagram...</span>
        )}
      </div>
      <details className="mermaid-source">
        <summary>Mermaid source</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
    </figure>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M6 5.5A1.5 1.5 0 0 1 7.5 4h7A1.5 1.5 0 0 1 16 5.5v7A1.5 1.5 0 0 1 14.5 14h-7A1.5 1.5 0 0 1 6 12.5v-7ZM3 8.5A1.5 1.5 0 0 1 4.5 7H5v5.5A2.5 2.5 0 0 0 7.5 15H13v.5A1.5 1.5 0 0 1 11.5 17h-7A1.5 1.5 0 0 1 3 15.5v-7Z" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 3.25 6.5 6.75l1.05 1.05 1.7-1.7v6.15h1.5V6.1l1.7 1.7 1.05-1.05L10 3.25ZM5 13.5h1.5v1.75h7V13.5H15v2.25A1.25 1.25 0 0 1 13.75 17h-7.5A1.25 1.25 0 0 1 5 15.75V13.5Z" />
    </svg>
  );
}
