import { useEffect, type RefObject } from "react";

type LiveZoomControllerTarget = {
  mode: "live";
  scroller: HTMLElement;
  surface: HTMLElement;
};

const BASE_LIVE_ZOOM_VARIABLES = {
  "--live-editor-font-size": 17,
  "--live-editor-line-height": 1.72,
  "--typora-live-code-font-size": 14,
  "--typora-live-content-padding-bottom": 72,
  "--typora-live-content-padding-top": 48,
  "--typora-live-content-padding-x": 56,
  "--typora-live-content-width": 860,
  "--typora-live-font-size": 17,
  "--typora-live-h1-size": 34,
  "--typora-live-h2-size": 28,
  "--typora-live-h3-size": 23,
  "--typora-live-h4-size": 19,
  "--typora-live-h5-size": 17,
  "--typora-live-h6-size": 15,
} as const;

export function resolveLiveZoomTarget(root: HTMLElement): LiveZoomControllerTarget | null {
  const scroller = root.querySelector(".cm-scroller");
  const content = root.querySelector(".cm-content");

  if (!(scroller instanceof HTMLElement)) {
    return null;
  }

  if (!(content instanceof HTMLElement)) {
    return null;
  }

  content.setAttribute("data-editor-document-surface", "true");
  content.setAttribute("data-editor-document-mode", "live");

  return {
    mode: "live",
    scroller,
    surface: content,
  };
}

function applyLiveZoom(root: HTMLElement, zoom: number) {
  root.style.setProperty("--live-zoom", String(zoom));

  for (const [property, baseValue] of Object.entries(BASE_LIVE_ZOOM_VARIABLES)) {
    const value = property === "--live-editor-line-height"
      ? String(baseValue * zoom)
      : `${baseValue * zoom}px`;
    root.style.setProperty(property, value);
  }
}

function clearLiveZoom(root: HTMLElement) {
  root.style.removeProperty("--live-zoom");

  for (const property of Object.keys(BASE_LIVE_ZOOM_VARIABLES)) {
    root.style.removeProperty(property);
  }
}

export function useLiveZoomController(
  rootRef: RefObject<HTMLElement | null>,
  { zoom }: { zoom: number },
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }

    const target = resolveLiveZoomTarget(root);
    applyLiveZoom(root, zoom);

    console.table({
      adapter: "LiveZoomAdapter",
      committedZoom: zoom,
      cssZoom: root.style.getPropertyValue("--live-zoom"),
      event: "editor-zoom-adapter",
      expectedFontSize: `${17 * zoom}px`,
      expectedPaddingTop: `${48 * zoom}px`,
      mode: "live",
      scrollerClass: target?.scroller.className ?? "",
      surfaceClass: target?.surface.className ?? "",
      targetFound: Boolean(target),
    });

    return () => {
      clearLiveZoom(root);
    };
  }, [rootRef, zoom]);
}
