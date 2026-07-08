import { useEffect, useMemo, useRef, useState } from "react";
import {
  exportSvgElementAsPng,
  exportSvgElementAsSvg,
  findRenderedSvg,
} from "../editor/diagramExport";

export type PlantUmlBlockProps = {
  diagramId: string;
  source: string;
};

const plantUmlServerUrl = "https://www.plantuml.com/plantuml/svg/";

export function PlantUmlBlock({ diagramId, source }: PlantUmlBlockProps) {
  const renderTargetRef = useRef<HTMLDivElement | null>(null);
  const [svgContent, setSvgContent] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const diagramUrl = useMemo(
    () => `${plantUmlServerUrl}${encodePlantUmlHex(source)}`,
    [source]
  );

  useEffect(() => {
    const abortController = new AbortController();

    async function loadDiagram() {
      setErrorMessage("");
      setSvgContent("");

      try {
        const response = await fetch(diagramUrl, {
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error(`PlantUML server returned ${response.status}.`);
        }

        const svgText = await response.text();
        if (!svgText.includes("<svg")) {
          throw new Error("PlantUML server did not return SVG content.");
        }

        setSvgContent(svgText);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void loadDiagram();

    return () => abortController.abort();
  }, [diagramUrl]);

  const exportPng = () => {
    const svg = findRenderedSvg(renderTargetRef.current);
    if (svg) exportSvgElementAsPng(svg, diagramId);
  };

  const exportSvg = () => {
    const svg = findRenderedSvg(renderTargetRef.current);
    if (svg) exportSvgElementAsSvg(svg, diagramId);
  };

  return (
    <figure
      className={`plantuml-card ${errorMessage ? "plantuml-card-error" : ""}`}
      id={diagramId}
    >
      <figcaption>
        <span>PlantUML Diagram</span>
        <span className="plantuml-privacy-note">
          Rendered by the configured PlantUML server
        </span>
      </figcaption>
      <div className="mermaid-block-toolbar">
        <button type="button" aria-label="Export PNG" title="Export PNG" disabled={!svgContent} onClick={exportPng}>
          <ExportIcon />
        </button>
        <button type="button" aria-label="Export SVG" title="Export SVG" disabled={!svgContent} onClick={exportSvg}>
          <SvgIcon />
        </button>
      </div>
      {errorMessage ? (
        <div className="plantuml-error">
          <strong>PlantUML render failed</strong>
          <span>Check your syntax or PlantUML server configuration.</span>
          <span>{errorMessage}</span>
        </div>
      ) : (
        <div
          className="plantuml-render-target"
          ref={renderTargetRef}
        >
          {svgContent ? (
            <span dangerouslySetInnerHTML={{ __html: svgContent }} />
          ) : (
            <span className="plantuml-loading">Rendering PlantUML...</span>
          )}
        </div>
      )}
      <details className="mermaid-source">
        <summary>Source</summary>
        <pre>{source}</pre>
      </details>
    </figure>
  );
}

function ExportIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 3.25 6.5 6.75l1.05 1.05 1.7-1.7v6.15h1.5V6.1l1.7 1.7 1.05-1.05L10 3.25ZM5 13.5h1.5v1.75h7V13.5H15v2.25A1.25 1.25 0 0 1 13.75 17h-7.5A1.25 1.25 0 0 1 5 15.75V13.5Z" />
    </svg>
  );
}

function SvgIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M5 3.5h10A1.5 1.5 0 0 1 16.5 5v10A1.5 1.5 0 0 1 15 16.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5Zm2 4.25h6V9H7V7.75Zm0 3h6V12H7v-1.25Zm0 3h4V15H7v-1.25Z" />
    </svg>
  );
}

function encodePlantUmlHex(source: string): string {
  const bytes = new TextEncoder().encode(source);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `~h${hex}`;
}
