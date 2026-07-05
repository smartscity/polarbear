import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

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
    if (!svgContent) {
      return;
    }

    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");

    downloadLink.href = objectUrl;
    downloadLink.download = `${diagramId}.svg`;
    downloadLink.click();
    URL.revokeObjectURL(objectUrl);
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
        <button type="button" onClick={() => void copySource()}>
          Copy Source
        </button>
        <button type="button" disabled={!svgContent} onClick={exportSvg}>
          Export SVG
        </button>
      </div>
      <div
        className="mermaid-render-target"
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
