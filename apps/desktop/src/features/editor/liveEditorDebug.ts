import type { EditorView } from "@codemirror/view";
import { NORMAL_APP_ZOOM } from "../zoom/appZoomRuntime";
import { readStoredDebugEnabled } from "../../shared/debug/debugSettings";
import { translateCurrent } from "../../shared/i18n/translate";

export type LiveDebugState = {
  version: string;
  source: string;
  eventCount: number;
  zoom: number;
  cssZoom: string;
  appCanvasZooming: string;
  paneHeight: number;
  themeHeight: number;
  editorHeight: number;
  contentFontSize: string;
  contentPaddingTop: string;
  contentWidth: number;
  contentHeight: number;
  contentClientWidth: number;
  contentScrollWidth: number;
  contentScrollHeight: number;
  scrollerClientWidth: number;
  scrollerScrollWidth: number;
  scrollerClientHeight: number;
  scrollerScrollHeight: number;
  scrollTop: number;
  maxScrollTop: number;
  editorContentHeight: number;
  viewportFrom: number;
  viewportTo: number;
  docLength: number;
  docLines: number;
  key: string;
  beforeSelection: string;
  afterSelection: string;
  wheel: string;
  mouse: string;
  mousePos: string;
  target: string;
  pinch: string;
  note: string;
};

export function isAppCanvasTransformActive(): boolean {
  return (
    isAppCanvasZooming() ||
    Math.abs(appCanvasZoom() - NORMAL_APP_ZOOM) > 0.0005
  );
}

export function isLiveDebugEnabled(): boolean {
  return readStoredDebugEnabled();
}

export function isLiveDebugPanelEnabled(): boolean {
  return readStoredDebugEnabled();
}

export function isLiveScrollDebugEnabled(): boolean {
  return readStoredDebugEnabled();
}

export function createInitialLiveDebugState(): LiveDebugState {
  return {
    version: "v8-debug",
    source: "init",
    eventCount: 0,
    zoom: 1,
    cssZoom: "",
    appCanvasZooming: "",
    paneHeight: 0,
    themeHeight: 0,
    editorHeight: 0,
    contentFontSize: "",
    contentPaddingTop: "",
    contentWidth: 0,
    contentHeight: 0,
    contentClientWidth: 0,
    contentScrollWidth: 0,
    contentScrollHeight: 0,
    scrollerClientWidth: 0,
    scrollerScrollWidth: 0,
    scrollerClientHeight: 0,
    scrollerScrollHeight: 0,
    scrollTop: 0,
    maxScrollTop: 0,
    editorContentHeight: 0,
    viewportFrom: 0,
    viewportTo: 0,
    docLength: 0,
    docLines: 0,
    key: "",
    beforeSelection: "",
    afterSelection: "",
    wheel: "",
    mouse: "",
    mousePos: "",
    target: "",
    pinch: "",
    note: "",
  };
}

export function collectLiveDebugState(
  pane: HTMLElement | null,
  view: EditorView | null,
  zoom: number,
  previous: LiveDebugState,
  source: string,
  extra: Partial<LiveDebugState> = {},
): LiveDebugState {
  const scroller = pane?.querySelector(".cm-scroller");
  const content = pane?.querySelector(".cm-content");
  const theme = pane?.querySelector(".cm-theme");
  const editor = pane?.querySelector(".cm-editor");
  const scrollerElement = scroller instanceof HTMLElement ? scroller : null;
  const contentElement = content instanceof HTMLElement ? content : null;
  const themeElement = theme instanceof HTMLElement ? theme : null;
  const editorElement = editor instanceof HTMLElement ? editor : null;
  const computedContent = contentElement ? window.getComputedStyle(contentElement) : null;
  const paneRect = pane?.getBoundingClientRect();
  const themeRect = themeElement?.getBoundingClientRect();
  const editorRect = editorElement?.getBoundingClientRect();
  const contentRect = contentElement?.getBoundingClientRect();

  return {
    ...previous,
    version: "v8-debug",
    source,
    eventCount: previous.eventCount + 1,
    note: "",
    zoom,
    cssZoom: zoom.toFixed(3),
    appCanvasZooming: document.documentElement.dataset.appCanvasZooming ?? "false",
    paneHeight: paneRect ? Math.round(paneRect.height) : 0,
    themeHeight: themeRect ? Math.round(themeRect.height) : 0,
    editorHeight: editorRect ? Math.round(editorRect.height) : 0,
    contentFontSize: computedContent?.fontSize ?? "",
    contentPaddingTop: computedContent?.paddingTop ?? "",
    contentWidth: contentRect ? Math.round(contentRect.width) : 0,
    contentHeight: contentRect ? Math.round(contentRect.height) : 0,
    contentClientWidth: contentElement?.clientWidth ?? 0,
    contentScrollWidth: contentElement?.scrollWidth ?? 0,
    contentScrollHeight: contentElement?.scrollHeight ?? 0,
    scrollerClientWidth: scrollerElement?.clientWidth ?? 0,
    scrollerScrollWidth: scrollerElement?.scrollWidth ?? 0,
    scrollerClientHeight: scrollerElement?.clientHeight ?? 0,
    scrollerScrollHeight: scrollerElement?.scrollHeight ?? 0,
    scrollTop: scrollerElement?.scrollTop ?? 0,
    maxScrollTop: scrollerElement
      ? Math.max(0, scrollerElement.scrollHeight - scrollerElement.clientHeight)
      : 0,
    editorContentHeight: view ? Math.round(view.contentHeight) : 0,
    viewportFrom: view?.viewport.from ?? 0,
    viewportTo: view?.viewport.to ?? 0,
    docLength: view?.state.doc.length ?? 0,
    docLines: view?.state.doc.lines ?? 0,
    afterSelection: describeSelection(view),
    ...extra,
  };
}

export function describeDebugTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) {
    return "unknown";
  }

  const tag = target.tagName.toLowerCase();
  const className = typeof target.className === "string"
    ? target.className.trim().replace(/\s+/g, ".")
    : "";

  return className ? `${tag}.${className}` : tag;
}

export function formatLiveDebugState(debugState: LiveDebugState): string {
  return [
    `LIVE DEBUG ${debugState.version} source=${debugState.source} events=${debugState.eventCount}`,
    `pane/theme/editor height=${debugState.paneHeight}/${debugState.themeHeight}/${debugState.editorHeight}`,
    `scroller client/scroll height=${debugState.scrollerClientHeight}/${debugState.scrollerScrollHeight} scrollTop=${debugState.scrollTop} max=${debugState.maxScrollTop}`,
    `scroller client/scroll width=${debugState.scrollerClientWidth}/${debugState.scrollerScrollWidth}`,
    `content rect/client/scroll height=${debugState.contentHeight}/${debugState.contentScrollHeight} width=${debugState.contentWidth}/${debugState.contentClientWidth}/${debugState.contentScrollWidth}`,
    `cm contentHeight=${debugState.editorContentHeight} viewport=${debugState.viewportFrom}-${debugState.viewportTo} doc=${debugState.docLines} lines/${debugState.docLength} chars`,
    `selection before=${debugState.beforeSelection || "n/a"} after=${debugState.afterSelection || "n/a"}`,
    `wheel=${debugState.wheel || "n/a"} mouse=${debugState.mouse || "n/a"} target=${debugState.target || "n/a"}`,
    `appZoom=${debugState.pinch || "n/a"}`,
    `appCanvasZooming=${debugState.appCanvasZooming || "false"} appCanvasZoom=${appCanvasZoom().toFixed(3)}`,
    `zoom=${Math.round(debugState.zoom * 100)}% css=${debugState.cssZoom || "n/a"} font=${debugState.contentFontSize || "n/a"} paddingTop=${debugState.contentPaddingTop || "n/a"}`,
    `note=${debugState.note || "n/a"}`,
  ].join("\n");
}

export function writeLiveDebugOverlay(text: string): void {
  const overlayId = "polarbear-live-debug-overlay";
  let overlay = document.getElementById(overlayId) as HTMLDivElement | null;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.dataset.polarbearDebugOverlay = "true";
    overlay.style.position = "fixed";
    overlay.style.left = "12px";
    overlay.style.bottom = "12px";
    overlay.style.zIndex = "2147483646";
    overlay.style.maxWidth = "760px";
    overlay.style.maxHeight = "38vh";
    overlay.style.margin = "0";
    overlay.style.padding = "10px 12px";
    overlay.style.overflow = "auto";
    overlay.style.border = "1px solid rgba(148, 163, 184, 0.45)";
    overlay.style.borderRadius = "8px";
    overlay.style.background = "rgba(15, 23, 42, 0.88)";
    overlay.style.color = "#e5edf8";
    overlay.style.font = "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace";
    overlay.style.pointerEvents = "none";
    overlay.style.whiteSpace = "pre-wrap";

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.debugCopy = "true";
    button.textContent = translateCurrent("common.copy");
    button.style.float = "right";
    button.style.margin = "0 0 8px 12px";
    button.style.pointerEvents = "auto";
    button.style.cursor = "pointer";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const debugText = overlay?.querySelector("pre")?.textContent ?? "";
      void copyLiveDebugText(debugText);
    });

    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.font = "inherit";
    overlay.append(button, pre);
    document.body.appendChild(overlay);
  }

  const pre = overlay.querySelector("pre");
  if (pre) {
    pre.textContent = text;
  }
}

export async function copyLiveDebugText(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Debug copy is best-effort and must not crash the editor.
  }
}

function isAppCanvasZooming(): boolean {
  return document.documentElement.dataset.appCanvasZooming === "true";
}

function appCanvasZoom(): number {
  const value = Number.parseFloat(document.documentElement.dataset.appCanvasZoom ?? "1");
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function describeSelection(view: EditorView | null): string {
  if (!view) {
    return "no-view";
  }

  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return `line=${line.number} col=${head - line.from + 1} pos=${head}`;
}
