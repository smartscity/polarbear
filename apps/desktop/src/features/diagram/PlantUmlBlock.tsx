import { useEffect, useRef, useState } from "react";
import {
  renderPlantUmlSvg,
} from "./plantUmlRenderer";
import { describePlantUmlRenderError } from "./plantUmlRenderError";
import { useI18n } from "../../shared/i18n/I18nProvider";
import {
  exportSvgElementAsPng,
  exportSvgElementAsSvg,
  findRenderedSvg,
} from "./diagramExport";
import { errorMessage as describeError } from "../../shared/tauri/invokeTauri";

export type PlantUmlBlockProps = {
  diagramId: string;
  source: string;
};

export function PlantUmlBlock({ diagramId, source }: PlantUmlBlockProps) {
  const { t } = useI18n();
  const renderTargetRef = useRef<HTMLDivElement | null>(null);
  const [svgContent, setSvgContent] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [requestedSource, setRequestedSource] = useState<string | null>(null);
  useEffect(() => {
    setActionStatus("");
    if (requestedSource !== source) {
      setErrorMessage("");
      setSvgContent("");
      return;
    }

    const abortController = new AbortController();

    async function loadDiagram() {
      setErrorMessage("");
      setSvgContent("");

      try {
        setSvgContent(await renderPlantUmlSvg(source, {
          signal: abortController.signal,
        }));
      } catch (error) {
        if (!abortController.signal.aborted) {
          setErrorMessage(describePlantUmlRenderError(error, t));
        }
      }
    }

    void loadDiagram();

    return () => abortController.abort();
  }, [requestedSource, source, t]);

  const exportPng = async () => {
    const svg = findRenderedSvg(renderTargetRef.current);
    if (!svg) {
      setActionStatus(t("diagram.exportUnavailable"));
      return;
    }

    try {
      await exportSvgElementAsPng(svg, diagramId);
    } catch (error) {
      setActionStatus(t("diagram.exportFailed", { error: describeError(error) }));
    }
  };

  const exportSvg = async () => {
    const svg = findRenderedSvg(renderTargetRef.current);
    if (!svg) {
      setActionStatus(t("diagram.exportUnavailable"));
      return;
    }

    try {
      await exportSvgElementAsSvg(svg, diagramId);
    } catch (error) {
      setActionStatus(t("diagram.exportFailed", { error: describeError(error) }));
    }
  };

  return (
    <figure
      className={`plantuml-card ${errorMessage ? "plantuml-card-error" : ""}`}
      id={diagramId}
    >
      <figcaption>
        <span>{t("diagram.plantUml")}</span>
        <span className="plantuml-privacy-note">
          {t("diagram.plantUmlPrivacy")}
        </span>
        {actionStatus ? <span role="status">{actionStatus}</span> : null}
      </figcaption>
      <div className="mermaid-block-toolbar">
        <button type="button" aria-label={t("diagram.exportPng")} title={t("diagram.exportPng")} disabled={!svgContent} onClick={() => void exportPng()}>
          <ExportIcon />
        </button>
        <button type="button" aria-label={t("diagram.exportSvg")} title={t("diagram.exportSvg")} disabled={!svgContent} onClick={() => void exportSvg()}>
          <SvgIcon />
        </button>
      </div>
      {errorMessage ? (
        <div className="plantuml-error">
          <strong>{t("diagram.plantUmlRenderFailed")}</strong>
          <span>{t("diagram.plantUmlCheckHint")}</span>
          <span>{errorMessage}</span>
        </div>
      ) : (
        <div
          className="plantuml-render-target"
          ref={renderTargetRef}
        >
          {svgContent ? (
            <span dangerouslySetInnerHTML={{ __html: svgContent }} />
          ) : requestedSource !== source ? (
            <div className="plantuml-remote-consent">
              <span>{t("diagram.plantUmlRemoteDisabled")}</span>
              <button type="button" onClick={() => setRequestedSource(source)}>
                {t("diagram.plantUmlRenderRemotely")}
              </button>
            </div>
          ) : (
            <span className="plantuml-loading">{t("diagram.renderingPlantUml")}</span>
          )}
        </div>
      )}
      <details className="mermaid-source">
        <summary>{t("diagram.source")}</summary>
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
