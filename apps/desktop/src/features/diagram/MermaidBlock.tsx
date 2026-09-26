import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import {
  exportSvgElementAsPng,
  exportSvgElementAsSvg,
  findRenderedSvg,
} from "./diagramExport";
import { renderMermaidSvg } from "./mermaidRenderer";
import { errorMessage } from "../../shared/tauri/invokeTauri";

const COPY_FEEDBACK_DURATION_MS = 1_400;

export type MermaidBlockProps = {
  source: string;
  diagramId: string;
};

export function MermaidBlock({ source, diagramId }: MermaidBlockProps) {
  const { t } = useI18n();
  const renderVersionRef = useRef(0);
  const renderingRef = useRef(false);
  const renderTargetRef = useRef<HTMLDivElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [svgContent, setSvgContent] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState("");

  useEffect(() => {
    renderVersionRef.current += 1;
    renderingRef.current = false;
    setSvgContent("");
    setRenderError(null);
    setActionStatus("");
  }, [diagramId, source]);

  useEffect(() => () => {
    renderVersionRef.current += 1;
  }, []);

  useEffect(() => {
    const target = renderTargetRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const scrollRoot = target.closest<HTMLElement>(".markdown-preview");
    const observer = new IntersectionObserver((entries) => {
      setIsNearViewport(entries.some((entry) => entry.isIntersecting));
    }, { root: scrollRoot, rootMargin: "300px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isNearViewport || svgContent || renderError || renderingRef.current) return;

    let cancelled = false;
    let started = false;
    let idleCallbackId: number | null = null;
    let timerId: number | null = null;
    const scrollRoot = renderTargetRef.current?.closest<HTMLElement>(".markdown-preview");

    const render = () => {
      idleCallbackId = null;
      timerId = null;
      if (cancelled || started) return;
      started = true;
      renderingRef.current = true;
      renderVersionRef.current += 1;
      const renderVersion = renderVersionRef.current;

      void renderMermaidSvg(`${diagramId}-${renderVersion}`, source)
        .then((nextSvgContent) => {
          if (renderVersionRef.current === renderVersion) {
            setSvgContent(nextSvgContent);
          }
        })
        .catch((error: unknown) => {
          if (renderVersionRef.current === renderVersion) {
            setRenderError(errorMessage(error));
          }
        })
        .finally(() => {
          if (renderVersionRef.current === renderVersion) {
            renderingRef.current = false;
          }
        });
    };

    const scheduleRender = () => {
      if (cancelled || started) return;
      if (idleCallbackId !== null) window.cancelIdleCallback(idleCallbackId);
      if (timerId !== null) window.clearTimeout(timerId);
      if (typeof window.requestIdleCallback === "function") {
        idleCallbackId = window.requestIdleCallback(render);
      } else {
        timerId = window.setTimeout(render, 180);
      }
    };
    scrollRoot?.addEventListener("scroll", scheduleRender, { passive: true });
    scheduleRender();

    return () => {
      cancelled = true;
      scrollRoot?.removeEventListener("scroll", scheduleRender);
      if (idleCallbackId !== null) window.cancelIdleCallback(idleCallbackId);
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [diagramId, isNearViewport, renderError, source, svgContent]);

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setActionStatus(t("common.copied"));
      window.setTimeout(() => setActionStatus(""), COPY_FEEDBACK_DURATION_MS);
    } catch (error) {
      setActionStatus(errorMessage(error));
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
      setActionStatus(t("diagram.exportFailed", { error: errorMessage(error) }));
    }
  };

  const exportPng = async () => {
    const svg = findRenderedSvg(renderTargetRef.current);
    if (!svg) {
      setActionStatus(t("diagram.exportUnavailable"));
      return;
    }

    try {
      await exportSvgElementAsPng(svg, diagramId);
    } catch (error) {
      setActionStatus(t("diagram.exportFailed", { error: errorMessage(error) }));
    }
  };

  if (renderError) {
    return (
      <figure className="mermaid-card mermaid-card-error">
        <figcaption>{t("diagram.mermaidRenderFailed")}</figcaption>
        <pre>{renderError}</pre>
      </figure>
    );
  }

  return (
    <figure className="mermaid-card">
      <figcaption>
        {t("diagram.mermaid")}
        {actionStatus ? <span role="status">{actionStatus}</span> : null}
      </figcaption>
      <div className="mermaid-block-toolbar">
        <button type="button" aria-label={t("diagram.copySource")} title={t("diagram.copySource")} onClick={() => void copySource()}>
          <CopyIcon />
        </button>
        <button type="button" aria-label={t("diagram.exportPng")} title={t("diagram.exportPng")} disabled={!svgContent} onClick={() => void exportPng()}>
          <ExportIcon />
        </button>
        <button type="button" aria-label={t("diagram.exportSvg")} title={t("diagram.exportSvg")} disabled={!svgContent} onClick={() => void exportSvg()}>
          <SvgIcon />
        </button>
      </div>
      <div
        className="mermaid-render-target"
        ref={renderTargetRef}
      >
        {svgContent ? (
          <span dangerouslySetInnerHTML={{ __html: svgContent }} />
        ) : (
          <span className="mermaid-loading">{t("diagram.renderingMermaid")}</span>
        )}
      </div>
      <details className="mermaid-source">
        <summary>{t("diagram.source")}</summary>
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

function SvgIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M5 3.5h10A1.5 1.5 0 0 1 16.5 5v10A1.5 1.5 0 0 1 15 16.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5Zm2 4.25h6V9H7V7.75Zm0 3h6V12H7v-1.25Zm0 3h4V15H7v-1.25Z" />
    </svg>
  );
}
