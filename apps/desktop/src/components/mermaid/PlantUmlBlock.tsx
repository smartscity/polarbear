import { useEffect, useMemo, useState } from "react";
import { MermaidZoomOverlay } from "./MermaidZoomOverlay";

export type PlantUmlBlockProps = {
  diagramId: string;
  source: string;
};

const plantUmlServerUrl = "https://www.plantuml.com/plantuml/svg/";

export function PlantUmlBlock({ diagramId, source }: PlantUmlBlockProps) {
  const [svgContent, setSvgContent] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isZoomOpen, setIsZoomOpen] = useState(false);
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
      {errorMessage ? (
        <div className="plantuml-error">
          <strong>PlantUML render failed</strong>
          <span>Check your syntax or PlantUML server configuration.</span>
          <span>{errorMessage}</span>
        </div>
      ) : (
        <button
          type="button"
          className="plantuml-render-target"
          disabled={!svgContent}
          onClick={() => {
            if (svgContent) {
              setIsZoomOpen(true);
            }
          }}
        >
          {svgContent ? (
            <span dangerouslySetInnerHTML={{ __html: svgContent }} />
          ) : (
            <span className="plantuml-loading">Rendering PlantUML...</span>
          )}
        </button>
      )}
      <details className="mermaid-source">
        <summary>Source</summary>
        <pre>{source}</pre>
      </details>
      {isZoomOpen ? (
        <MermaidZoomOverlay
          source={source}
          svgContent={svgContent}
          onClose={() => setIsZoomOpen(false)}
        />
      ) : null}
    </figure>
  );
}

function encodePlantUmlHex(source: string): string {
  const bytes = new TextEncoder().encode(source);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `~h${hex}`;
}
