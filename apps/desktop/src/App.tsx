import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  findNext,
  findPrevious,
  openSearchPanel,
} from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  MarkdownEditor,
  type MarkdownEditorView,
} from "./components/editor/MarkdownEditor";
import { InsertCodeFenceDialog } from "./components/editor/InsertCodeFenceDialog";
import { InsertTableDialog } from "./components/editor/InsertTableDialog";
import { MarkdownPreview } from "./components/editor/MarkdownPreview";
import { TyporaLiveEditor } from "./components/editor/TyporaLiveEditor";
import { AppShell } from "./components/layout/AppShell";
import {
  CreateItemDialog,
  type CreateItemType,
} from "./components/workspace/CreateItemDialog";
import { useAppShortcuts } from "./commands/useAppShortcuts";
import { useNativeAppMenu } from "./commands/useNativeAppMenu";
import { applyMarkdownFormat } from "./markdown/applyMarkdownFormat";
import type { AppCommand, AppCommandPayload } from "./model/AppCommand";
import type { ViewMode } from "./model/ViewMode";
import {
  applyThemeTokens,
  readStoredTheme,
  storeTheme,
  type ThemeName,
} from "./theme/themeTokens";
import {
  ConnectGithubDialog,
  LinkGithubWorkspaceDialog,
  RepositorySyncStatusDialog,
} from "./repository/RepositoryDialogs";
import {
  disconnectGithub,
  getRepositoryAccount,
  getRepositorySyncStatus,
  getWorkspaceRepositoryBinding,
  linkWorkspaceToGithub,
  listGithubRepositories,
  pullWorkspace,
  pushWorkspace,
  syncWorkspaceNow,
  validateGithubToken,
  type GithubRepository,
  type RepositoryAccount,
  type RepositoryBinding,
  type RepositorySyncStatus,
} from "./repository/repositoryApi";
import {
  findWorkspaceItem,
  type WorkspaceDocumentMap,
  type WorkspaceItem,
} from "./model/WorkspaceFile";
import {
  chooseMarkdownFile,
  chooseMarkdownSavePath,
  chooseImageFile,
  chooseWorkspaceFolder,
  copyImageAsset,
  createMarkdownFile,
  createWorkspaceDirectory,
  listWorkspaceFiles,
  loadMarkdownFile,
  moveEntry,
  openMarkdownFile,
  renameEntry,
  revealInFileManager,
  saveMarkdownFile,
  saveImageAsset,
  writeMarkdownFile,
} from "./tauri/workspaceCommands";
import { AppZoomManager } from "./zoom/AppZoomManager";

const initialWorkspace: WorkspaceItem[] = [];

const initialDocuments: WorkspaceDocumentMap = {
  "untitled:1": "",
};

const initialDocumentTitles: Record<string, string> = {
  "untitled:1": "Untitled",
};

const NORMAL_APP_ZOOM = 1;
const MIN_COMMITTED_APP_ZOOM = 1;
const MIN_INTERACTION_APP_ZOOM = 0.82;
const MAX_APP_ZOOM = 3;
const APP_ZOOM_STEP = 0.1;
const ZOOM_SETTLE_DELAY_MS = 320;
const ZOOM_SNAP_DURATION_MS = 120;
const APP_ZOOM_SCROLL_LOCK_MS = 520;
const WHEEL_ZOOM_DELTA_LIMIT = 80;
const WHEEL_ZOOM_SENSITIVITY = 0.0045;
const NATIVE_PINCH_ZOOM_SENSITIVITY = 2.35;
const NATIVE_PINCH_SCALE_SENSITIVITY = 1.35;
const NATIVE_GESTURE_WHEEL_SUPPRESS_MS = 160;
const APP_CANVAS_ZOOM_ENABLED = true;
const EDITOR_WORKSPACE_ZOOM_ENABLED = false;
const EDITOR_ZOOM_DEFAULT = 1;
const EDITOR_ZOOM_MIN = 0.5;
const EDITOR_ZOOM_MAX = 8;
const EDITOR_ZOOM_STEP = 1.1;

type EditorZoomMode = "source" | "live" | "preview" | "split";

function clampEditorZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return EDITOR_ZOOM_DEFAULT;
  }

  return Math.max(EDITOR_ZOOM_MIN, Math.min(EDITOR_ZOOM_MAX, value));
}

function toEditorZoomMode(viewMode: ViewMode): EditorZoomMode {
  if (viewMode === "edit") {
    return "source";
  }

  return viewMode;
}

type EditorZoomDebugSource =
  | "menu"
  | "native-pinch"
  | "shortcut"
  | "wheel";

type ActiveDocumentZoomMode = Exclude<EditorZoomMode, "split">;

type ActiveDocumentZoomTarget = {
  host: HTMLElement;
  mode: ActiveDocumentZoomMode;
  scrollport: HTMLElement;
  surface: HTMLElement;
};

type ContinuousZoomFocusSource =
  | "last-pointer"
  | "native-pinch"
  | "viewport-center"
  | "wheel-client";

type ContinuousZoomInput = "native-pinch" | "wheel";

type ContinuousZoomFocus = {
  clientX: number;
  clientY: number;
  docX: number;
  docY: number;
  focusSource: ContinuousZoomFocusSource;
  focusX: number;
  focusY: number;
};

type ContinuousZoomSession = ContinuousZoomFocus & {
  baseZoom: number;
  cloneWrapper: HTMLElement;
  input: ContinuousZoomInput;
  originalSurfaceVisibility: string;
  overlay: HTMLElement;
  target: ActiveDocumentZoomTarget;
  visualZoom: number;
};

type ContinuousZoomRequest = {
  input: ContinuousZoomInput;
  nextZoom: number;
};

function readEditorZoomDomDebug(mode: EditorZoomMode, zoom: number) {
  if (mode === "source") {
    const scrollerSelector = ".editor-workspace-edit .cm-scroller";
    const surfaceSelector = ".editor-workspace-edit .cm-content";
    const rootSelector = ".editor-workspace-edit [data-editor-document-host][data-editor-document-mode='source']";
    const root = document.querySelector(rootSelector);
    const scroller = document.querySelector(scrollerSelector);
    const surface = document.querySelector(surfaceSelector);
    const contentStyle = surface instanceof HTMLElement
      ? getComputedStyle(surface)
      : null;
    const computedFontSize = contentStyle?.fontSize ?? "";
    const expectedFontSize = Number.parseFloat(
      root instanceof HTMLElement
        ? root.style.getPropertyValue("--source-editor-font-size")
        : "",
    );
    const actualFontSize = Number.parseFloat(computedFontSize);

    return {
      adapter: "SourceZoomAdapter",
      adapterFound: true,
      committedZoom: Number(zoom.toFixed(4)),
      computedFontSize,
      computedLineHeight: contentStyle?.lineHeight ?? "",
      computedPaddingTop: contentStyle?.paddingTop ?? "",
      computedTransform: contentStyle?.transform ?? "",
      cssVarApplied: root instanceof HTMLElement &&
        root.style.getPropertyValue("--source-editor-font-size").trim().length > 0,
      cssZoom: "",
      expectedFontSize: `${14 * zoom}px`,
      expectedPaddingTop: "",
      hostSelector: rootSelector,
      scrollerClass: scroller?.className ?? "",
      scrollerFound: scroller instanceof HTMLElement,
      scrollerSelector,
      surfaceClass: surface?.className ?? "",
      surfaceFound: surface instanceof HTMLElement,
      surfaceSelector,
      targetFound: scroller instanceof HTMLElement && surface instanceof HTMLElement,
      transformApplied: false,
      visualChanged: Number.isFinite(expectedFontSize) &&
        Number.isFinite(actualFontSize) &&
        Math.abs(actualFontSize - expectedFontSize) < 0.5,
    };
  }

  if (mode === "live") {
    const scrollerSelector = ".typora-live-editor-pane .cm-scroller";
    const surfaceSelector = ".typora-live-editor-pane .cm-content";
    const rootSelector = ".typora-live-editor-pane[data-editor-document-host][data-editor-document-mode='live']";
    const root = document.querySelector(rootSelector);
    const scroller = document.querySelector(scrollerSelector);
    const surface = document.querySelector(surfaceSelector);
    const rootStyle = root instanceof HTMLElement ? getComputedStyle(root) : null;
    const surfaceStyle = surface instanceof HTMLElement ? getComputedStyle(surface) : null;
    const expectedFontSize = Number.parseFloat(
      root instanceof HTMLElement
        ? root.style.getPropertyValue("--typora-live-font-size")
        : "",
    );
    const actualFontSize = Number.parseFloat(surfaceStyle?.fontSize ?? "");

    return {
      adapter: "LiveZoomAdapter",
      adapterFound: true,
      committedZoom: Number(zoom.toFixed(4)),
      computedFontSize: surfaceStyle?.fontSize ?? "",
      computedLineHeight: surfaceStyle?.lineHeight ?? "",
      computedPaddingTop: surfaceStyle?.paddingTop ?? "",
      computedTransform: surfaceStyle?.transform ?? "",
      cssVarApplied: Boolean(rootStyle?.getPropertyValue("--typora-live-font-size").trim()),
      cssZoom: rootStyle?.getPropertyValue("--live-zoom").trim() ?? "",
      expectedFontSize: `${17 * zoom}px`,
      expectedPaddingTop: `${48 * zoom}px`,
      hostSelector: rootSelector,
      liveCssZoom: rootStyle?.getPropertyValue("--live-zoom").trim() ?? "",
      scrollerClass: scroller?.className ?? "",
      scrollerFound: scroller instanceof HTMLElement,
      scrollerSelector,
      surfaceClass: surface?.className ?? "",
      surfaceFound: surface instanceof HTMLElement,
      surfaceSelector,
      targetFound: scroller instanceof HTMLElement && surface instanceof HTMLElement,
      transformApplied: false,
      visualChanged: Number.isFinite(expectedFontSize) &&
        Number.isFinite(actualFontSize) &&
        Math.abs(actualFontSize - expectedFontSize) < 0.5,
    };
  }

  if (mode === "preview") {
    const scrollerSelector = ".markdown-preview";
    const surfaceSelector = ".markdown-preview-surface";
    const rootSelector = ".markdown-preview[data-editor-document-host][data-editor-document-mode='preview']";
    const previewRoot = document.querySelector(scrollerSelector);
    const surface = document.querySelector(surfaceSelector);
    const surfaceStyle = surface instanceof HTMLElement ? getComputedStyle(surface) : null;
    const cssZoom = surfaceStyle?.getPropertyValue("zoom") ?? "";

    return {
      adapter: "PreviewZoomAdapter",
      adapterFound: true,
      committedZoom: Number(zoom.toFixed(4)),
      computedFontSize: surfaceStyle?.fontSize ?? "",
      computedPaddingTop: surfaceStyle?.paddingTop ?? "",
      computedTransform: surfaceStyle?.transform ?? "",
      cssVarApplied: surface instanceof HTMLElement &&
        surface.style.getPropertyValue("--preview-zoom").trim().length > 0,
      cssZoom,
      expectedFontSize: "",
      expectedPaddingTop: "",
      hostSelector: rootSelector,
      scrollerClass: previewRoot?.className ?? "",
      scrollerFound: previewRoot instanceof HTMLElement,
      scrollerSelector,
      surfaceClass: surface?.className ?? "",
      surfaceFound: surface instanceof HTMLElement,
      surfaceSelector,
      targetFound: previewRoot instanceof HTMLElement && surface instanceof HTMLElement,
      transformApplied: Boolean(surfaceStyle?.getPropertyValue("zoom")),
      visualChanged: cssZoom.trim().length > 0 && cssZoom !== "1",
    };
  }

  return {
    adapter: "SplitZoomAdapter",
    adapterFound: false,
    committedZoom: Number(zoom.toFixed(4)),
    cssVarApplied: false,
    cssZoom: "",
    computedFontSize: "",
    computedPaddingTop: "",
    computedTransform: "",
    expectedFontSize: "",
    expectedPaddingTop: "",
    hostSelector: "",
    scrollerClass: "",
    scrollerFound: false,
    scrollerSelector: "",
    surfaceClass: "",
    surfaceFound: false,
    surfaceSelector: "",
    targetFound: false,
    transformApplied: false,
    visualChanged: false,
  };
}

function scheduleEditorZoomDebug(params: {
  mode: EditorZoomMode;
  nextZoom: number;
  oldZoom: number;
  source: EditorZoomDebugSource;
}) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      console.table({
        event: "editor-zoom",
        editorZoom: Number(params.nextZoom.toFixed(4)),
        input: params.source,
        mode: params.mode,
        nextZoom: Number(params.nextZoom.toFixed(4)),
        oldZoom: Number(params.oldZoom.toFixed(4)),
        source: params.source,
        ...readEditorZoomDomDebug(params.mode, params.nextZoom),
      });
    });
  });
}

function resolveActiveDocumentZoomTarget(
  mode: EditorZoomMode,
): ActiveDocumentZoomTarget | null {
  if (mode === "split") {
    return null;
  }

  const selectors: Record<ActiveDocumentZoomMode, {
    host: string;
    scrollport: string;
    surface: string;
  }> = {
    live: {
      host: ".typora-live-editor-pane[data-editor-document-host][data-editor-document-mode='live']",
      scrollport: ".typora-live-editor-pane .cm-scroller",
      surface: ".typora-live-editor-pane .cm-content",
    },
    preview: {
      host: ".markdown-preview[data-editor-document-host][data-editor-document-mode='preview']",
      scrollport: ".markdown-preview",
      surface: ".markdown-preview-surface",
    },
    source: {
      host: ".editor-workspace-edit [data-editor-document-host][data-editor-document-mode='source']",
      scrollport: ".editor-workspace-edit .cm-scroller",
      surface: ".editor-workspace-edit .cm-content",
    },
  };

  const selector = selectors[mode];
  const host = document.querySelector(selector.host);
  const scrollport = document.querySelector(selector.scrollport);
  const surface = document.querySelector(selector.surface);

  if (
    !(host instanceof HTMLElement) ||
    !(scrollport instanceof HTMLElement) ||
    !(surface instanceof HTMLElement)
  ) {
    return null;
  }

  return {
    host,
    mode,
    scrollport,
    surface,
  };
}

function overlayContextClassForMode(mode: ActiveDocumentZoomMode): string {
  if (mode === "live") {
    return "typora-live-editor-pane";
  }

  if (mode === "preview") {
    return "markdown-preview";
  }

  return "editor-pane";
}

function beginActiveDocumentVisualZoom(
  target: ActiveDocumentZoomTarget,
  focus: ContinuousZoomFocus,
  baseZoom: number,
  input: ContinuousZoomInput,
): ContinuousZoomSession {
  const scrollportRect = target.scrollport.getBoundingClientRect();
  const surfaceRect = target.surface.getBoundingClientRect();
  const overlay = document.createElement("div");
  const cloneWrapper = document.createElement("div");
  const clone = target.surface.cloneNode(true) as HTMLElement;

  overlay.className = [
    "active-document-zoom-overlay",
    `active-document-zoom-overlay-${target.mode}`,
    overlayContextClassForMode(target.mode),
  ].join(" ");
  overlay.setAttribute("data-active-document-zoom-overlay", "true");
  overlay.setAttribute("data-editor-document-mode", target.mode);
  overlay.style.position = "fixed";
  overlay.style.left = `${scrollportRect.left}px`;
  overlay.style.top = `${scrollportRect.top}px`;
  overlay.style.width = `${scrollportRect.width}px`;
  overlay.style.height = `${scrollportRect.height}px`;
  overlay.style.padding = "0";
  overlay.style.margin = "0";
  overlay.style.border = "0";
  overlay.style.borderRadius = "0";
  overlay.style.background = "transparent";
  overlay.style.overflow = "hidden";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "2147483000";

  cloneWrapper.className = "active-document-zoom-clone-wrapper";
  cloneWrapper.style.position = "absolute";
  cloneWrapper.style.left = `${surfaceRect.left - scrollportRect.left}px`;
  cloneWrapper.style.top = `${surfaceRect.top - scrollportRect.top}px`;
  cloneWrapper.style.width = `${surfaceRect.width}px`;
  cloneWrapper.style.minHeight = `${surfaceRect.height}px`;
  cloneWrapper.style.transformOrigin = "0 0";
  cloneWrapper.style.willChange = "transform";

  clone.classList.add("active-document-zoom-clone");
  clone.setAttribute("aria-hidden", "true");
  clone.style.pointerEvents = "none";

  cloneWrapper.appendChild(clone);
  overlay.appendChild(cloneWrapper);
  document.body.appendChild(overlay);

  const originalSurfaceVisibility = target.surface.style.visibility;
  target.surface.style.visibility = "hidden";
  target.host.setAttribute("data-active-document-zooming", "true");

  return {
    ...focus,
    baseZoom,
    cloneWrapper,
    input,
    originalSurfaceVisibility,
    overlay,
    target,
    visualZoom: baseZoom,
  };
}

function updateActiveDocumentVisualZoom(session: ContinuousZoomSession, nextZoom: number) {
  const safeBaseZoom = session.baseZoom > 0 ? session.baseZoom : EDITOR_ZOOM_DEFAULT;
  const visualScale = nextZoom / safeBaseZoom;
  const translateX = session.focusX * (1 - visualScale);
  const translateY = session.focusY * (1 - visualScale);
  const oldScrollLeft = session.target.scrollport.scrollLeft;
  const oldScrollTop = session.target.scrollport.scrollTop;
  const newScrollLeft = session.docX * nextZoom - session.focusX;
  const newScrollTop = session.docY * nextZoom - session.focusY;

  session.visualZoom = nextZoom;
  session.cloneWrapper.style.transform =
    `translate(${translateX}px, ${translateY}px) scale(${visualScale})`;

  console.table({
    changedFontSizeThisFrame: false,
    changedPaddingThisFrame: false,
    changedWidthThisFrame: false,
    docX: Number(session.docX.toFixed(2)),
    docY: Number(session.docY.toFixed(2)),
    focusSource: session.focusSource,
    focusX: Number(session.focusX.toFixed(2)),
    focusY: Number(session.focusY.toFixed(2)),
    input: session.input,
    mermaidRenderThisFrame: 0,
    mode: session.target.mode,
    newScale: Number(nextZoom.toFixed(4)),
    newScrollLeft: Number(newScrollLeft.toFixed(2)),
    newScrollTop: Number(newScrollTop.toFixed(2)),
    oldScale: Number(safeBaseZoom.toFixed(4)),
    oldScrollLeft: Number(oldScrollLeft.toFixed(2)),
    oldScrollTop: Number(oldScrollTop.toFixed(2)),
    phase: "continuous-zoom",
    reactStateUpdateThisFrame: false,
    requestMeasureThisFrame: 0,
    usingOverlay: true,
  });
}

function cleanupActiveDocumentVisualZoom(session: ContinuousZoomSession) {
  session.target.surface.style.visibility = session.originalSurfaceVisibility;
  session.target.host.removeAttribute("data-active-document-zooming");
  session.overlay.remove();
}

function clampInteractionZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return NORMAL_APP_ZOOM;
  }

  return Math.max(MIN_INTERACTION_APP_ZOOM, Math.min(MAX_APP_ZOOM, value));
}

function clampCommittedZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return NORMAL_APP_ZOOM;
  }

  return Math.max(MIN_COMMITTED_APP_ZOOM, Math.min(MAX_APP_ZOOM, value));
}

function isAppZoomWheelEvent(event: WheelEvent): boolean {
  return (event.metaKey || event.ctrlKey) && Math.abs(event.deltaY) > Math.abs(event.deltaX);
}

function consumeAppZoomWheelEvent(event: WheelEvent): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function dispatchAppZoomDebug(
  phase: string,
  params: {
    canvas?: HTMLElement | null;
    canvasSize?: HTMLElement | null;
    prepared?: boolean;
    viewport?: HTMLElement | null;
    zoom?: number;
  } = {},
): void {
  const viewport = params.viewport ?? null;
  const canvasSize = params.canvasSize ?? null;
  const canvas = params.canvas ?? null;
  const note = [
    `phase=${phase}`,
    `zoom=${Number((params.zoom ?? 1).toFixed(4))}`,
    `prepared=${params.prepared ? 1 : 0}`,
    `viewportScroll=${viewport ? `${Math.round(viewport.scrollLeft)},${Math.round(viewport.scrollTop)}` : "n/a"}`,
    `viewportClient=${viewport ? `${viewport.clientWidth}x${viewport.clientHeight}` : "n/a"}`,
    `viewportScrollSize=${viewport ? `${viewport.scrollWidth}x${viewport.scrollHeight}` : "n/a"}`,
    `spacerClient=${canvasSize ? `${canvasSize.clientWidth}x${canvasSize.clientHeight}` : "n/a"}`,
    `spacerScroll=${canvasSize ? `${canvasSize.scrollWidth}x${canvasSize.scrollHeight}` : "n/a"}`,
    `canvasOffset=${canvas ? `${canvas.offsetLeft},${canvas.offsetTop}` : "n/a"}`,
    `canvasSize=${canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : "n/a"}`,
    `transform=${canvas?.style.transform || "n/a"}`,
  ].join(" ");

  window.dispatchEvent(new CustomEvent("polarbear-app-zoom-debug", {
    detail: {
      note,
      phase,
    },
  }));
}

function setAppCanvasZoomDataset(zoom: number): void {
  document.documentElement.dataset.appCanvasZoom = Number.isFinite(zoom)
    ? zoom.toFixed(6)
    : "1.000000";
}

function shouldIgnoreAppZoomEvent(event: Event): boolean {
  if (document.querySelector(".image-viewer-overlay, .mermaid-zoom-overlay")) {
    return true;
  }

  const target = event.target;
  return target instanceof Element && Boolean(target.closest(
    ".image-viewer-overlay, .mermaid-zoom-overlay",
  ));
}

function shouldLetEditorHandleWheel(event: WheelEvent): boolean {
  if (isAppZoomWheelEvent(event)) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  const scroller =
    target.closest(".cm-scroller") ??
    target.closest(".typora-live-editor-pane, .editor-pane")?.querySelector(".cm-scroller");
  if (!(scroller instanceof HTMLElement)) {
    return false;
  }

  return Math.abs(event.deltaY) >= Math.abs(event.deltaX);
}

type NativePinchEventLike = CustomEvent<{
  delta?: number;
  magnification?: number;
  phase?: number | string;
  scale?: number;
  state?: number | string;
  x?: number;
  y?: number;
}>;
type NativePinchPayload = NativePinchEventLike["detail"];

type AppCanvasSize = {
  width: number;
  height: number;
};

type AppCanvasPlacement = {
  canvasHeight: number;
  canvasWidth: number;
  offsetLeft: number;
  offsetTop: number;
};

type ZoomAnchor = {
  pointerX: number;
  pointerY: number;
  canvasX: number;
  canvasY: number;
};

type ZoomDocumentTextAnchor = {
  type: "text";
  focusClientX: number;
  focusClientY: number;
  offsetX: number;
  offsetY: number;
  pos: number;
  scroller: HTMLElement;
  view: EditorView;
};

type ZoomDocumentBlockAnchor = {
  type: "block";
  blockElement: HTMLElement;
  blockId: string;
  focusClientX: number;
  focusClientY: number;
  locked: true;
  relativeX: number;
  relativeY: number;
  scroller: HTMLElement;
  view: EditorView;
};

type ZoomDocumentTableCellAnchor = {
  type: "table-cell";
  cellIndex: number;
  focusClientX: number;
  focusClientY: number;
  locked: true;
  relativeX: number;
  relativeY: number;
  rowIndex: number;
  scroller: HTMLElement;
  tableBlockElement: HTMLElement;
  tableBlockId: string;
  view: EditorView;
};

type ZoomDocumentAnchor =
  | ZoomDocumentBlockAnchor
  | ZoomDocumentTableCellAnchor
  | ZoomDocumentTextAnchor;

const ZOOM_ANCHOR_BLOCK_SELECTOR = [
  "[data-zoom-anchor-block]",
  "[data-markdown-block-id]",
  ".mermaid-block",
  ".plantuml-block",
  ".markdown-image-block",
  ".markdown-table-block",
  ".cm-typora-diagram-preview",
  ".cm-typora-image-preview",
  ".cm-typora-table-preview",
  ".cm-typora-math-block",
  ".cm-preview-widget",
].join(",");

function readAppCanvasSize(): AppCanvasSize {
  return {
    width: Math.max(320, Math.floor(window.visualViewport?.width ?? window.innerWidth)),
    height: Math.max(320, Math.floor(window.visualViewport?.height ?? window.innerHeight)),
  };
}

function measureAppCanvasSize(canvas: HTMLElement | null): AppCanvasSize {
  const viewportSize = readAppCanvasSize();
  if (!canvas) {
    return viewportSize;
  }

  const content = canvas.firstElementChild instanceof HTMLElement
    ? canvas.firstElementChild
    : canvas;
  const width = Math.max(
    viewportSize.width,
    content.scrollWidth,
    content.clientWidth,
    canvas.scrollWidth,
    canvas.clientWidth,
  );
  const height = Math.max(
    viewportSize.height,
    content.scrollHeight,
    content.clientHeight,
    canvas.scrollHeight,
    canvas.clientHeight,
  );

  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
  };
}

function isNativePinchEndPhase(phase: unknown): boolean {
  if (typeof phase === "number") {
    // NSEventPhaseEnded = 8, NSEventPhaseCancelled = 16.
    return (phase & 8) !== 0 || (phase & 16) !== 0;
  }

  return typeof phase === "string" && [
    "ended",
    "end",
    "cancelled",
    "canceled",
    "failed",
  ].includes(phase.toLowerCase());
}

function escapeAttributeSelectorValue(value: string): string {
  if (
    typeof CSS !== "undefined" &&
    typeof CSS.escape === "function"
  ) {
    return CSS.escape(value);
  }

  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function findZoomAnchorBlockById(
  blockId: string,
  root: ParentNode = document,
): HTMLElement | null {
  if (!blockId) {
    return null;
  }

  const element = root.querySelector(
    `[data-markdown-block-id="${escapeAttributeSelectorValue(blockId)}"]`,
  );

  return element instanceof HTMLElement ? element : null;
}

function findTableCellForZoomAnchor(
  anchor: ZoomDocumentTableCellAnchor,
): HTMLElement | null {
  const tableBlockElement = anchor.tableBlockElement.isConnected
    ? anchor.tableBlockElement
    : findZoomAnchorBlockById(anchor.tableBlockId, anchor.view.dom);

  if (!tableBlockElement || !anchor.view.dom.contains(tableBlockElement)) {
    return null;
  }

  const table = tableBlockElement instanceof HTMLTableElement
    ? tableBlockElement
    : tableBlockElement.querySelector("table");
  if (!(table instanceof HTMLTableElement)) {
    return null;
  }

  const row = table.rows.item(anchor.rowIndex);
  const cell = row?.cells.item(anchor.cellIndex) ?? null;

  return cell instanceof HTMLElement ? cell : null;
}

export function App() {
  const editorViewRef = useRef<MarkdownEditorView | null>(null);
  const appZoomManagerRef = useRef<AppZoomManager | null>(null);
  const zoomViewportRef = useRef<HTMLDivElement | null>(null);
  const zoomCanvasSizeRef = useRef<HTMLDivElement | null>(null);
  const zoomCanvasRef = useRef<HTMLDivElement | null>(null);
  const appZoomRef = useRef(1);
  const appCanvasSizeRef = useRef<AppCanvasSize>(readAppCanvasSize());
  const appCanvasPlacementRef = useRef<AppCanvasPlacement | null>(null);
  const appZoomInteractionSurfacePreparedRef = useRef(false);
  const zoomRafRef = useRef(0);
  const pendingZoomRef = useRef(1);
  const pendingAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const activeZoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const activeDocumentZoomAnchorRef = useRef<ZoomDocumentAnchor | null>(null);
  const documentAnchorRestoreFrameRef = useRef(0);
  const documentAnchorSecondRestoreFrameRef = useRef(0);
  const documentAnchorThirdRestoreFrameRef = useRef(0);
  const lastNativeGestureAtRef = useRef(0);
  const lastZoomClientRef = useRef<{ x: number; y: number } | null>(null);
  const zoomScrollUnlockTimerRef = useRef<number | null>(null);
  const zoomScrollLockUntilRef = useRef(0);
  const zoomSettleTimerRef = useRef<number | null>(null);
  const zoomSnapAnimationRef = useRef(0);
  const editorZoomRef = useRef(EDITOR_ZOOM_DEFAULT);
  const lastEditorNativeGestureAtRef = useRef(0);
  const activeContinuousZoomRef = useRef<ContinuousZoomSession | null>(null);
  const continuousZoomIdleTimerRef = useRef<number | null>(null);
  const continuousZoomRafRef = useRef(0);
  const continuousZoomRestoreFrameRef = useRef(0);
  const continuousZoomSecondRestoreFrameRef = useRef(0);
  const pendingContinuousZoomRef = useRef<ContinuousZoomRequest | null>(null);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  const [workspaceItems, setWorkspaceItems] = useState(initialWorkspace);
  const [documents, setDocuments] = useState(initialDocuments);
  const [activeFileId, setActiveFileId] = useState("untitled:1");
  const [documentTitles, setDocumentTitles] = useState<Record<string, string>>(
    initialDocumentTitles,
  );
  const [untitledCounter, setUntitledCounter] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("live"); // split、live
  const [appZoom, setAppZoom] = useState(1);
  const [editorZoom, setEditorZoom] = useState(EDITOR_ZOOM_DEFAULT);
  const [appCanvasSize, setAppCanvasSize] = useState<AppCanvasSize>(() =>
    appCanvasSizeRef.current,
  );
  const [themeName, setThemeName] = useState<ThemeName>(() =>
    readStoredTheme(),
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [dirtyFileIds, setDirtyFileIds] = useState<Set<string>>(new Set());
  const [collapseVersion, setCollapseVersion] = useState(0);
  const [folderRevealRequest, setFolderRevealRequest] = useState<{
    folderId: string;
    version: number;
  } | null>(null);
  const [selectedTreeItemId, setSelectedTreeItemId] = useState("");
  const [createItemType, setCreateItemType] = useState<CreateItemType | null>(
    null,
  );
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
  const [renameItemId, setRenameItemId] = useState<string | null>(null);
  const [isInsertTableDialogOpen, setIsInsertTableDialogOpen] = useState(false);
  const [isInsertCodeFenceDialogOpen, setIsInsertCodeFenceDialogOpen] =
    useState(false);
  const [repositoryAccount, setRepositoryAccount] =
    useState<RepositoryAccount | null>(null);
  const [repositoryBinding, setRepositoryBinding] =
    useState<RepositoryBinding | null>(null);
  const [githubRepositories, setGithubRepositories] = useState<
    GithubRepository[]
  >([]);
  const [repositorySyncStatus, setRepositorySyncStatus] =
    useState<RepositorySyncStatus | null>(null);
  const [repositoryDialog, setRepositoryDialog] = useState<
    "connect" | "link" | "status" | null
  >(null);
  const [isRepositoryBusy, setIsRepositoryBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Open a local workspace folder to create and save files on disk.",
  );

  const markdownContent = documents[activeFileId] ?? "";
  const activeFile = findWorkspaceItem(workspaceItems, activeFileId);
  const activeFileName =
    activeFile?.name ?? documentTitles[activeFileId] ?? "Untitled";
  const isDirty = dirtyFileIds.has(activeFileId);

  const commitZoom = useCallback((nextZoom: number) => {
    const zoom = clampCommittedZoom(nextZoom);
    appZoomRef.current = zoom;
    setAppCanvasZoomDataset(zoom);
    setAppZoom((currentZoom) =>
      Math.abs(currentZoom - zoom) < 0.0005 ? currentZoom : zoom,
    );
  }, []);

  const applyCanvasZoom = useCallback((nextZoom: number, allowElasticZoom = true) => {
    const zoom = allowElasticZoom
      ? clampInteractionZoom(nextZoom)
      : clampCommittedZoom(nextZoom);
    const size = appCanvasSizeRef.current;
    const viewport = zoomViewportRef.current;
    const viewportClientWidth = viewport?.clientWidth ?? 0;
    const viewportClientHeight = viewport?.clientHeight ?? 0;

    appZoomRef.current = zoom;
    setAppCanvasZoomDataset(zoom);
    if (!allowElasticZoom) {
      appZoomInteractionSurfacePreparedRef.current = false;
    }

    if (zoomCanvasSizeRef.current) {
      const canvasWidth = Math.max(viewportClientWidth, Math.ceil(size.width * zoom));
      const canvasHeight = Math.max(viewportClientHeight, Math.ceil(size.height * zoom));
      appCanvasPlacementRef.current = {
        canvasHeight,
        canvasWidth,
        offsetLeft: 0,
        offsetTop: 0,
      };
      zoomCanvasSizeRef.current.style.width = `${canvasWidth}px`;
      zoomCanvasSizeRef.current.style.height = `${canvasHeight}px`;
    }

    if (zoomCanvasRef.current) {
      zoomCanvasRef.current.style.left = "0px";
      zoomCanvasRef.current.style.top = "0px";
      zoomCanvasRef.current.style.width = `${size.width}px`;
      zoomCanvasRef.current.style.height = `${size.height}px`;
      zoomCanvasRef.current.style.transformOrigin = "top left";
      zoomCanvasRef.current.style.transform = `scale(${zoom})`;
    }

    if (viewport && zoomCanvasSizeRef.current && !allowElasticZoom) {
      const maxScrollLeft = Math.max(0, zoomCanvasSizeRef.current.scrollWidth - viewport.clientWidth);
      const maxScrollTop = Math.max(0, zoomCanvasSizeRef.current.scrollHeight - viewport.clientHeight);
      viewport.scrollLeft = Math.max(0, Math.min(maxScrollLeft, viewport.scrollLeft));
      viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, viewport.scrollTop));
    }
  }, []);

  const prepareAppZoomInteractionSurface = useCallback(() => {
    if (appZoomInteractionSurfacePreparedRef.current) {
      return;
    }

    appZoomInteractionSurfacePreparedRef.current = true;
    const size = appCanvasSizeRef.current;
    const preparedWidth = Math.ceil(size.width * MAX_APP_ZOOM);
    const preparedHeight = Math.ceil(size.height * MAX_APP_ZOOM);

    if (zoomCanvasSizeRef.current) {
      zoomCanvasSizeRef.current.style.width = `${preparedWidth}px`;
      zoomCanvasSizeRef.current.style.height = `${preparedHeight}px`;
    }
    appCanvasPlacementRef.current = {
      canvasHeight: preparedHeight,
      canvasWidth: preparedWidth,
      offsetLeft: 0,
      offsetTop: 0,
    };

    if (zoomCanvasRef.current) {
      zoomCanvasRef.current.style.width = `${size.width}px`;
      zoomCanvasRef.current.style.height = `${size.height}px`;
      zoomCanvasRef.current.style.left = "0px";
      zoomCanvasRef.current.style.top = "0px";
      zoomCanvasRef.current.style.transformOrigin = "top left";
    }
  }, []);

  const getAnchorCanvasPoint = useCallback((
    viewport: HTMLElement,
    zoom: number,
    clientX?: number,
    clientY?: number,
  ): ZoomAnchor => {
    const rect = viewport.getBoundingClientRect();
    const rawPointerX =
      typeof clientX === "number" && Number.isFinite(clientX)
        ? clientX - rect.left
        : viewport.clientWidth / 2;
    const rawPointerY =
      typeof clientY === "number" && Number.isFinite(clientY)
        ? clientY - rect.top
        : viewport.clientHeight / 2;
    const pointerX = Math.max(0, Math.min(rect.width, rawPointerX));
    const pointerY = Math.max(0, Math.min(rect.height, rawPointerY));
    const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : NORMAL_APP_ZOOM;
    const canvasOffsetLeft = zoomCanvasRef.current?.offsetLeft ?? 0;
    const canvasOffsetTop = zoomCanvasRef.current?.offsetTop ?? 0;

    return {
      pointerX,
      pointerY,
      canvasX: (viewport.scrollLeft + pointerX - canvasOffsetLeft) / safeZoom,
      canvasY: (viewport.scrollTop + pointerY - canvasOffsetTop) / safeZoom,
    };
  }, []);

  const getCurrentCodeMirrorView = useCallback((): EditorView | null => {
    const view = editorViewRef.current as unknown as EditorView | null;
    if (
      !view ||
      typeof view.posAtCoords !== "function" ||
      typeof view.coordsAtPos !== "function" ||
      !view.scrollDOM
    ) {
      return null;
    }

    return view;
  }, []);

  const captureDocumentZoomAnchor = useCallback((
    clientX?: number,
    clientY?: number,
  ): ZoomDocumentAnchor | null => {
    const view = getCurrentCodeMirrorView();
    if (!view || !view.dom.isConnected || !view.scrollDOM.isConnected) {
      return null;
    }

    const scroller = view.scrollDOM;
    const scrollerRect = scroller.getBoundingClientRect();
    const hasClientPoint =
      typeof clientX === "number" &&
      Number.isFinite(clientX) &&
      typeof clientY === "number" &&
      Number.isFinite(clientY);

    if (
      hasClientPoint &&
      (
        clientX < scrollerRect.left ||
        clientX > scrollerRect.right ||
        clientY < scrollerRect.top ||
        clientY > scrollerRect.bottom
      )
    ) {
      return null;
    }

    const focusClientX = hasClientPoint
      ? (clientX as number)
      : scrollerRect.left + scrollerRect.width / 2;
    const focusClientY = hasClientPoint
      ? (clientY as number)
      : scrollerRect.top + scrollerRect.height / 2;

    const target = document.elementFromPoint(focusClientX, focusClientY);
    const tableCell = target instanceof Element
      ? target.closest("td, th")
      : null;
    const tableBlockElement = tableCell instanceof HTMLElement
      ? tableCell.closest("[data-markdown-block-id].markdown-table-block, .cm-typora-table-preview[data-markdown-block-id]")
      : null;

    if (
      tableCell instanceof HTMLTableCellElement &&
      tableBlockElement instanceof HTMLElement &&
      view.dom.contains(tableCell) &&
      view.dom.contains(tableBlockElement)
    ) {
      const row = tableCell.parentElement instanceof HTMLTableRowElement
        ? tableCell.parentElement
        : null;
      const table = tableCell.closest("table");
      const rowIndex = table instanceof HTMLTableElement && row
        ? Array.prototype.indexOf.call(table.rows, row)
        : -1;
      const cellIndex = tableCell.cellIndex;
      const rect = tableCell.getBoundingClientRect();

      if (rowIndex >= 0 && cellIndex >= 0 && rect.width > 0 && rect.height > 0) {
        return {
          type: "table-cell",
          cellIndex,
          focusClientX,
          focusClientY,
          locked: true,
          relativeX: (focusClientX - rect.left) / Math.max(1, rect.width),
          relativeY: (focusClientY - rect.top) / Math.max(1, rect.height),
          rowIndex,
          scroller,
          tableBlockElement,
          tableBlockId: tableBlockElement.dataset.markdownBlockId ?? "",
          view,
        };
      }
    }

    const blockElement = target instanceof Element
      ? target.closest(ZOOM_ANCHOR_BLOCK_SELECTOR)
      : null;

    if (
      blockElement instanceof HTMLElement &&
      view.dom.contains(blockElement)
    ) {
      const rect = blockElement.getBoundingClientRect();

      if (rect.width > 0 && rect.height > 0) {
        return {
          type: "block",
          blockElement,
          blockId: blockElement.dataset.markdownBlockId ?? "",
          focusClientX,
          focusClientY,
          locked: true,
          relativeX: (focusClientX - rect.left) / Math.max(1, rect.width),
          relativeY: (focusClientY - rect.top) / Math.max(1, rect.height),
          scroller,
          view,
        };
      }
    }

    const pos = view.posAtCoords({
      x: focusClientX,
      y: focusClientY,
    });

    if (pos === null) {
      return null;
    }

    const beforeRect = view.coordsAtPos(pos);

    return {
      type: "text",
      focusClientX,
      focusClientY,
      offsetX: beforeRect ? focusClientX - beforeRect.left : 0,
      offsetY: beforeRect ? focusClientY - beforeRect.top : 0,
      pos,
      scroller,
      view,
    };
  }, [getCurrentCodeMirrorView]);

  const restoreDocumentZoomAnchor = useCallback((anchor: ZoomDocumentAnchor | null) => {
    if (!anchor || !anchor.view.dom.isConnected || !anchor.scroller.isConnected) {
      return;
    }

    const visualZoom = Math.max(0.0001, appZoomRef.current);

    if (anchor.type === "table-cell") {
      const cell = findTableCellForZoomAnchor(anchor);
      if (!cell) {
        return;
      }

      const rect = cell.getBoundingClientRect();
      const currentFocusX = rect.left + rect.width * anchor.relativeX;
      const currentFocusY = rect.top + rect.height * anchor.relativeY;
      const deltaX = currentFocusX - anchor.focusClientX;
      const deltaY = currentFocusY - anchor.focusClientY;

      if (Math.abs(deltaY) > 0.5) {
        anchor.scroller.scrollTop += deltaY / visualZoom;
      }

      if (
        Math.abs(deltaX) > 0.5 &&
        anchor.scroller.scrollWidth > anchor.scroller.clientWidth
      ) {
        anchor.scroller.scrollLeft += deltaX / visualZoom;
      }
      return;
    }

    if (anchor.type === "block") {
      const blockElement = anchor.blockElement.isConnected
        ? anchor.blockElement
        : findZoomAnchorBlockById(anchor.blockId, anchor.view.dom);

      if (!blockElement || !anchor.view.dom.contains(blockElement)) {
        return;
      }

      const rect = blockElement.getBoundingClientRect();
      const currentFocusX = rect.left + rect.width * anchor.relativeX;
      const currentFocusY = rect.top + rect.height * anchor.relativeY;
      const deltaX = currentFocusX - anchor.focusClientX;
      const deltaY = currentFocusY - anchor.focusClientY;

      if (Math.abs(deltaY) > 0.5) {
        anchor.scroller.scrollTop += deltaY / visualZoom;
      }

      if (
        Math.abs(deltaX) > 0.5 &&
        anchor.scroller.scrollWidth > anchor.scroller.clientWidth
      ) {
        anchor.scroller.scrollLeft += deltaX / visualZoom;
      }
      return;
    }

    const view = anchor.view;
    const pos = Math.max(0, Math.min(view.state.doc.length, anchor.pos));
    const afterRect = view.coordsAtPos(pos);

    if (!afterRect) {
      return;
    }

    const expectedTop = anchor.focusClientY - anchor.offsetY;
    const expectedLeft = anchor.focusClientX - anchor.offsetX;
    const deltaY = afterRect.top - expectedTop;
    const deltaX = afterRect.left - expectedLeft;

    if (Math.abs(deltaY) > 0.5) {
      anchor.scroller.scrollTop += deltaY / visualZoom;
    }

    if (
      Math.abs(deltaX) > 0.5 &&
      anchor.scroller.scrollWidth > anchor.scroller.clientWidth
    ) {
      anchor.scroller.scrollLeft += deltaX / visualZoom;
    }
  }, []);

  const requestDocumentZoomAnchorMeasure = useCallback((anchor: ZoomDocumentAnchor | null) => {
    if (!anchor || !anchor.view.dom.isConnected || !anchor.scroller.isConnected) {
      return;
    }

    if (anchor.type !== "text") {
      restoreDocumentZoomAnchor(anchor);
      return;
    }

    const view = anchor.view;
    const pos = Math.max(0, Math.min(view.state.doc.length, anchor.pos));
    view.requestMeasure({
      read() {
        return view.coordsAtPos(pos);
      },
      write(afterRect) {
        if (!afterRect || !anchor.scroller.isConnected) {
          return;
        }

        const visualZoom = Math.max(0.0001, appZoomRef.current);
        const expectedTop = anchor.focusClientY - anchor.offsetY;
        const expectedLeft = anchor.focusClientX - anchor.offsetX;
        const deltaY = afterRect.top - expectedTop;
        const deltaX = afterRect.left - expectedLeft;

        if (Math.abs(deltaY) > 0.5) {
          anchor.scroller.scrollTop += deltaY / visualZoom;
        }

        if (
          Math.abs(deltaX) > 0.5 &&
          anchor.scroller.scrollWidth > anchor.scroller.clientWidth
        ) {
          anchor.scroller.scrollLeft += deltaX / visualZoom;
        }
      },
    });
  }, [restoreDocumentZoomAnchor]);

  const scheduleDocumentZoomAnchorRestore = useCallback((anchor: ZoomDocumentAnchor | null) => {
    if (!anchor) {
      return;
    }

    if (documentAnchorRestoreFrameRef.current) {
      window.cancelAnimationFrame(documentAnchorRestoreFrameRef.current);
      documentAnchorRestoreFrameRef.current = 0;
    }

    if (documentAnchorSecondRestoreFrameRef.current) {
      window.cancelAnimationFrame(documentAnchorSecondRestoreFrameRef.current);
      documentAnchorSecondRestoreFrameRef.current = 0;
    }

    if (documentAnchorThirdRestoreFrameRef.current) {
      window.cancelAnimationFrame(documentAnchorThirdRestoreFrameRef.current);
      documentAnchorThirdRestoreFrameRef.current = 0;
    }

    restoreDocumentZoomAnchor(anchor);
    requestDocumentZoomAnchorMeasure(anchor);

    documentAnchorRestoreFrameRef.current = window.requestAnimationFrame(() => {
      documentAnchorRestoreFrameRef.current = 0;
      restoreDocumentZoomAnchor(anchor);
      requestDocumentZoomAnchorMeasure(anchor);

      documentAnchorSecondRestoreFrameRef.current = window.requestAnimationFrame(() => {
        documentAnchorSecondRestoreFrameRef.current = 0;
        restoreDocumentZoomAnchor(anchor);
        requestDocumentZoomAnchorMeasure(anchor);

        if (anchor.type === "table-cell") {
          documentAnchorThirdRestoreFrameRef.current = window.requestAnimationFrame(() => {
            documentAnchorThirdRestoreFrameRef.current = 0;
            restoreDocumentZoomAnchor(anchor);
            requestDocumentZoomAnchorMeasure(anchor);
          });
        }
      });
    });
  }, [requestDocumentZoomAnchorMeasure, restoreDocumentZoomAnchor]);

  const applyVisualZoomAtAnchor = useCallback((nextZoom: number, anchor: ZoomAnchor) => {
    const viewport = zoomViewportRef.current;
    const zoom = clampInteractionZoom(nextZoom);

    appZoomRef.current = zoom;
    setAppCanvasZoomDataset(zoom);
    prepareAppZoomInteractionSurface();

    if (zoomCanvasRef.current) {
      const scrollLeft = viewport?.scrollLeft ?? 0;
      const scrollTop = viewport?.scrollTop ?? 0;
      const translateX = anchor.pointerX + scrollLeft - anchor.canvasX * zoom;
      const translateY = anchor.pointerY + scrollTop - anchor.canvasY * zoom;

      zoomCanvasRef.current.style.left = "0px";
      zoomCanvasRef.current.style.top = "0px";
      zoomCanvasRef.current.style.transformOrigin = "top left";
      zoomCanvasRef.current.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${zoom})`;
    }
  }, [prepareAppZoomInteractionSurface]);

  const applyZoomAtAnchor = useCallback((
    nextZoom: number,
    anchor: ZoomAnchor,
    allowElasticZoom = true,
  ) => {
    const viewport = zoomViewportRef.current;
    const zoom = allowElasticZoom
      ? clampInteractionZoom(nextZoom)
      : clampCommittedZoom(nextZoom);

    if (!viewport) {
      applyCanvasZoom(zoom, allowElasticZoom);
      return;
    }

    const size = appCanvasSizeRef.current;
    const viewportClientWidth = viewport.clientWidth;
    const viewportClientHeight = viewport.clientHeight;
    const desiredScrollLeft = anchor.canvasX * zoom - anchor.pointerX;
    const desiredScrollTop = anchor.canvasY * zoom - anchor.pointerY;
    const shouldUseElasticOffset = allowElasticZoom && zoom < MIN_COMMITTED_APP_ZOOM;
    const usePreparedInteractionSurface =
      appZoomInteractionSurfacePreparedRef.current &&
      zoom > NORMAL_APP_ZOOM + 0.0005;
    const canvasOffsetLeft = shouldUseElasticOffset
      ? Math.max(0, -desiredScrollLeft)
      : 0;
    const canvasOffsetTop = shouldUseElasticOffset
      ? Math.max(0, -desiredScrollTop)
      : 0;
    const canvasSizeWidth = usePreparedInteractionSurface
      ? Math.max(viewportClientWidth, Math.ceil(size.width * MAX_APP_ZOOM))
      : Math.max(
          viewportClientWidth,
          Math.ceil(size.width * zoom + canvasOffsetLeft),
        );
    const canvasSizeHeight = usePreparedInteractionSurface
      ? Math.max(viewportClientHeight, Math.ceil(size.height * MAX_APP_ZOOM))
      : Math.max(
          viewportClientHeight,
          Math.ceil(size.height * zoom + canvasOffsetTop),
        );
    const maxScrollLeft = Math.max(0, canvasSizeWidth - viewportClientWidth);
    const maxScrollTop = Math.max(0, canvasSizeHeight - viewportClientHeight);
    const nextScrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, desiredScrollLeft + canvasOffsetLeft),
    );
    const nextScrollTop = Math.max(
      0,
      Math.min(maxScrollTop, desiredScrollTop + canvasOffsetTop),
    );

    appZoomRef.current = zoom;
    setAppCanvasZoomDataset(zoom);

    if (zoomCanvasSizeRef.current && !usePreparedInteractionSurface) {
      appCanvasPlacementRef.current = {
        canvasHeight: canvasSizeHeight,
        canvasWidth: canvasSizeWidth,
        offsetLeft: canvasOffsetLeft,
        offsetTop: canvasOffsetTop,
      };
      zoomCanvasSizeRef.current.style.width = `${canvasSizeWidth}px`;
      zoomCanvasSizeRef.current.style.height = `${canvasSizeHeight}px`;
    }

    if (zoomCanvasRef.current) {
      zoomCanvasRef.current.style.left = `${canvasOffsetLeft}px`;
      zoomCanvasRef.current.style.top = `${canvasOffsetTop}px`;
      if (!usePreparedInteractionSurface) {
        zoomCanvasRef.current.style.width = `${size.width}px`;
        zoomCanvasRef.current.style.height = `${size.height}px`;
      }
      zoomCanvasRef.current.style.transformOrigin = "top left";
      zoomCanvasRef.current.style.transform = `scale(${zoom})`;
    }

    viewport.scrollLeft = nextScrollLeft;
    viewport.scrollTop = nextScrollTop;
  }, [applyCanvasZoom]);

  const syncCanvasBaseSizePreservingAnchor = useCallback(() => {
    if (activeZoomAnchorRef.current || zoomRafRef.current || zoomSnapAnimationRef.current) {
      return;
    }

    if (
      APP_CANVAS_ZOOM_ENABLED &&
      Math.abs(appZoomRef.current - NORMAL_APP_ZOOM) > 0.0005
    ) {
      return;
    }

    const viewport = zoomViewportRef.current;
    const currentZoom = appZoomRef.current;
    const anchor = viewport
      ? getAnchorCanvasPoint(viewport, currentZoom)
      : null;
    const nextSize = measureAppCanvasSize(zoomCanvasRef.current);

    appCanvasSizeRef.current = nextSize;
    setAppCanvasSize((currentSize) =>
      currentSize.width === nextSize.width && currentSize.height === nextSize.height
        ? currentSize
        : nextSize,
    );
    if (viewport && anchor) {
      applyZoomAtAnchor(currentZoom, anchor, currentZoom < MIN_COMMITTED_APP_ZOOM);
      return;
    }

    applyCanvasZoom(currentZoom, currentZoom < MIN_COMMITTED_APP_ZOOM);
  }, [applyCanvasZoom, applyZoomAtAnchor, getAnchorCanvasPoint]);

  const zoomAtPoint = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const viewport = zoomViewportRef.current;
    if (!viewport) {
      applyCanvasZoom(nextZoom);
      return;
    }

    const anchor = getAnchorCanvasPoint(viewport, appZoomRef.current, clientX, clientY);
    applyZoomAtAnchor(nextZoom, anchor);
  }, [applyCanvasZoom, applyZoomAtAnchor, getAnchorCanvasPoint]);

  const cancelZoomSnapAnimation = useCallback(() => {
    if (zoomSnapAnimationRef.current) {
      window.cancelAnimationFrame(zoomSnapAnimationRef.current);
      zoomSnapAnimationRef.current = 0;
    }
  }, []);

  const lockAppZoomScroll = useCallback(() => {
    zoomScrollLockUntilRef.current = Math.max(
      zoomScrollLockUntilRef.current,
      Date.now() + APP_ZOOM_SCROLL_LOCK_MS,
    );
    document.documentElement.dataset.appCanvasZooming = "true";

    if (zoomScrollUnlockTimerRef.current !== null) {
      window.clearTimeout(zoomScrollUnlockTimerRef.current);
    }

    zoomScrollUnlockTimerRef.current = window.setTimeout(() => {
      if (Date.now() < zoomScrollLockUntilRef.current) {
        return;
      }

      zoomScrollUnlockTimerRef.current = null;
      if (appZoomRef.current <= NORMAL_APP_ZOOM + 0.0005) {
        applyCanvasZoom(NORMAL_APP_ZOOM, false);
      }
      dispatchAppZoomDebug("unlock", {
        canvas: zoomCanvasRef.current,
        canvasSize: zoomCanvasSizeRef.current,
        prepared: appZoomInteractionSurfacePreparedRef.current,
        viewport: zoomViewportRef.current,
        zoom: appZoomRef.current,
      });
      delete document.documentElement.dataset.appCanvasZooming;
      window.dispatchEvent(new CustomEvent("polarbear-app-canvas-zoom-settled"));
    }, APP_ZOOM_SCROLL_LOCK_MS + 40);
  }, [applyCanvasZoom]);

  const animateZoomTo = useCallback((
    targetZoom: number,
    anchor: ZoomAnchor,
  ) => {
    const startZoom = appZoomRef.current;
    const committedTargetZoom = clampCommittedZoom(targetZoom);
    const startTime = performance.now();

    lockAppZoomScroll();
    cancelZoomSnapAnimation();

    const runFrame = (now: number) => {
      lockAppZoomScroll();
      const progress = Math.min(1, (now - startTime) / ZOOM_SNAP_DURATION_MS);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextZoom = startZoom + (committedTargetZoom - startZoom) * easedProgress;

      applyVisualZoomAtAnchor(nextZoom, anchor);

      if (progress < 1) {
        zoomSnapAnimationRef.current = window.requestAnimationFrame(runFrame);
        return;
      }

      zoomSnapAnimationRef.current = 0;
      applyZoomAtAnchor(committedTargetZoom, anchor, false);
      appZoomInteractionSurfacePreparedRef.current = false;
      commitZoom(committedTargetZoom);
    };

    zoomSnapAnimationRef.current = window.requestAnimationFrame(runFrame);
  }, [
    applyZoomAtAnchor,
    applyVisualZoomAtAnchor,
    cancelZoomSnapAnimation,
    commitZoom,
    lockAppZoomScroll,
  ]);

  const settleZoomAfterGesture = useCallback((clientX?: number, clientY?: number) => {
    lockAppZoomScroll();
    const viewport = zoomViewportRef.current;
    if (!viewport) {
      commitZoom(appZoomRef.current);
      activeZoomAnchorRef.current = null;
      appZoomInteractionSurfacePreparedRef.current = false;
      return;
    }

    const currentZoom = appZoomRef.current;
    const fallbackPoint = lastZoomClientRef.current;
    const anchor = activeZoomAnchorRef.current ?? getAnchorCanvasPoint(
        viewport,
        currentZoom,
        clientX ?? fallbackPoint?.x,
        clientY ?? fallbackPoint?.y,
      );

    if (currentZoom < MIN_COMMITTED_APP_ZOOM) {
      dispatchAppZoomDebug("settle-before-reset", {
        canvas: zoomCanvasRef.current,
        canvasSize: zoomCanvasSizeRef.current,
        prepared: appZoomInteractionSurfacePreparedRef.current,
        viewport,
        zoom: currentZoom,
      });
      animateZoomTo(NORMAL_APP_ZOOM, anchor);
      activeZoomAnchorRef.current = null;
      activeDocumentZoomAnchorRef.current = null;
      return;
    }

    dispatchAppZoomDebug("settle-before", {
      canvas: zoomCanvasRef.current,
      canvasSize: zoomCanvasSizeRef.current,
      prepared: appZoomInteractionSurfacePreparedRef.current,
      viewport,
      zoom: currentZoom,
    });
    applyZoomAtAnchor(currentZoom, anchor, false);
    if (currentZoom <= NORMAL_APP_ZOOM + 0.0005) {
      appZoomInteractionSurfacePreparedRef.current = false;
    }
    commitZoom(currentZoom);
    dispatchAppZoomDebug("settle-after", {
      canvas: zoomCanvasRef.current,
      canvasSize: zoomCanvasSizeRef.current,
      prepared: appZoomInteractionSurfacePreparedRef.current,
      viewport,
      zoom: currentZoom,
    });
    activeZoomAnchorRef.current = null;
    activeDocumentZoomAnchorRef.current = null;
  }, [
    animateZoomTo,
    applyZoomAtAnchor,
    commitZoom,
    getAnchorCanvasPoint,
    lockAppZoomScroll,
  ]);

  const scheduleZoomSettle = useCallback((clientX?: number, clientY?: number) => {
    if (zoomSettleTimerRef.current !== null) {
      window.clearTimeout(zoomSettleTimerRef.current);
    }

    zoomSettleTimerRef.current = window.setTimeout(() => {
      zoomSettleTimerRef.current = null;
      settleZoomAfterGesture(clientX, clientY);
    }, ZOOM_SETTLE_DELAY_MS);
  }, [settleZoomAfterGesture]);

  const scheduleZoomAtPoint = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const viewport = zoomViewportRef.current;

    prepareAppZoomInteractionSurface();
    lockAppZoomScroll();
    cancelZoomSnapAnimation();
    pendingZoomRef.current = clampInteractionZoom(nextZoom);
    pendingAnchorRef.current = { x: clientX, y: clientY };
    lastZoomClientRef.current = { x: clientX, y: clientY };

    if (viewport && !activeZoomAnchorRef.current) {
      activeZoomAnchorRef.current = getAnchorCanvasPoint(
        viewport,
        appZoomRef.current,
        clientX,
        clientY,
      );
    }

    if (zoomRafRef.current) {
      return;
    }

    zoomRafRef.current = window.requestAnimationFrame(() => {
      zoomRafRef.current = 0;
      const anchor = pendingAnchorRef.current;
      if (!anchor) {
        return;
      }

      if (activeZoomAnchorRef.current) {
        applyVisualZoomAtAnchor(pendingZoomRef.current, activeZoomAnchorRef.current);
        return;
      }

      zoomAtPoint(pendingZoomRef.current, anchor.x, anchor.y);
    });
  }, [
    applyVisualZoomAtAnchor,
    cancelZoomSnapAnimation,
    getAnchorCanvasPoint,
    lockAppZoomScroll,
    prepareAppZoomInteractionSurface,
    zoomAtPoint,
  ]);

  const zoomAtViewportCenter = useCallback((nextZoom: number) => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
      commitZoom(NORMAL_APP_ZOOM);
      return;
    }

    const viewport = zoomViewportRef.current;
    if (!viewport) {
      applyCanvasZoom(nextZoom);
      commitZoom(nextZoom);
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const anchor = getAnchorCanvasPoint(viewport, appZoomRef.current, clientX, clientY);
    const zoom = clampInteractionZoom(nextZoom);

    cancelZoomSnapAnimation();

    if (zoom < MIN_COMMITTED_APP_ZOOM) {
      animateZoomTo(NORMAL_APP_ZOOM, anchor);
      return;
    }

    applyZoomAtAnchor(zoom, anchor, false);
    commitZoom(zoom);
  }, [
    animateZoomTo,
    applyCanvasZoom,
    applyZoomAtAnchor,
    cancelZoomSnapAnimation,
    commitZoom,
    getAnchorCanvasPoint,
  ]);

  const panZoomViewport = useCallback((deltaX: number, deltaY: number): boolean => {
    const viewport = zoomViewportRef.current;
    if (!viewport) {
      return false;
    }

    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const beforeLeft = viewport.scrollLeft;
    const beforeTop = viewport.scrollTop;

    viewport.scrollLeft = Math.max(0, Math.min(maxScrollLeft, beforeLeft + deltaX));
    viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, beforeTop + deltaY));

    return viewport.scrollLeft !== beforeLeft || viewport.scrollTop !== beforeTop;
  }, []);

  useLayoutEffect(() => {
    if (!APP_CANVAS_ZOOM_ENABLED || EDITOR_WORKSPACE_ZOOM_ENABLED) {
      return undefined;
    }

    const syncCanvasSize = () => {
      syncCanvasBaseSizePreservingAnchor();
    };

    syncCanvasSize();
    window.addEventListener("resize", syncCanvasSize);
    window.visualViewport?.addEventListener("resize", syncCanvasSize);
    const resizeObserver = new ResizeObserver(syncCanvasSize);
    if (zoomCanvasRef.current?.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(zoomCanvasRef.current.firstElementChild);
    }

    return () => {
      window.removeEventListener("resize", syncCanvasSize);
      window.visualViewport?.removeEventListener("resize", syncCanvasSize);
      resizeObserver.disconnect();
    };
  }, [syncCanvasBaseSizePreservingAnchor]);

  useEffect(() => {
    return () => {
      if (zoomRafRef.current) {
        window.cancelAnimationFrame(zoomRafRef.current);
      }

      if (zoomSettleTimerRef.current !== null) {
        window.clearTimeout(zoomSettleTimerRef.current);
      }

      if (zoomScrollUnlockTimerRef.current !== null) {
        window.clearTimeout(zoomScrollUnlockTimerRef.current);
      }

      if (zoomSnapAnimationRef.current) {
        window.cancelAnimationFrame(zoomSnapAnimationRef.current);
      }

      if (documentAnchorRestoreFrameRef.current) {
        window.cancelAnimationFrame(documentAnchorRestoreFrameRef.current);
      }

      if (documentAnchorSecondRestoreFrameRef.current) {
        window.cancelAnimationFrame(documentAnchorSecondRestoreFrameRef.current);
      }

      if (documentAnchorThirdRestoreFrameRef.current) {
        window.cancelAnimationFrame(documentAnchorThirdRestoreFrameRef.current);
      }

      if (continuousZoomRafRef.current) {
        window.cancelAnimationFrame(continuousZoomRafRef.current);
      }

      if (continuousZoomRestoreFrameRef.current) {
        window.cancelAnimationFrame(continuousZoomRestoreFrameRef.current);
      }

      if (continuousZoomSecondRestoreFrameRef.current) {
        window.cancelAnimationFrame(continuousZoomSecondRestoreFrameRef.current);
      }

      if (continuousZoomIdleTimerRef.current !== null) {
        window.clearTimeout(continuousZoomIdleTimerRef.current);
      }

      if (activeContinuousZoomRef.current) {
        cleanupActiveDocumentVisualZoom(activeContinuousZoomRef.current);
        activeContinuousZoomRef.current = null;
      }

      delete document.documentElement.dataset.appCanvasZooming;
    };
  }, []);

  useEffect(() => {
    if (viewMode === "preview") {
      editorViewRef.current = null;
    }
  }, [viewMode]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      lastPointerClientRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    };

    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove, { capture: true });
    };
  }, []);

  useEffect(() => {
    applyThemeTokens(themeName);
    storeTheme(themeName);
  }, [themeName]);

  useEffect(() => {
    if (APP_CANVAS_ZOOM_ENABLED || EDITOR_WORKSPACE_ZOOM_ENABLED) {
      return undefined;
    }

    setAppCanvasZoomDataset(NORMAL_APP_ZOOM);
    delete document.documentElement.dataset.appCanvasZooming;
    const manager = new AppZoomManager();
    appZoomManagerRef.current = manager;
    void manager.init();

    return () => {
      manager.dispose();
      if (appZoomManagerRef.current === manager) {
        appZoomManagerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
      return;
    }

    window.localStorage.removeItem("polarbear.appZoom");
    void invoke("set_app_zoom", { zoom: NORMAL_APP_ZOOM });
  }, []);

  useEffect(() => {
    if (
      !APP_CANVAS_ZOOM_ENABLED ||
      EDITOR_WORKSPACE_ZOOM_ENABLED
    ) {
      return undefined;
    }

    const handleAppZoomWheel = (event: WheelEvent) => {
      if (shouldIgnoreAppZoomEvent(event)) {
        return;
      }

      const isZoomWheel = isAppZoomWheelEvent(event);
      const isNativePinchWheelNoise =
        Date.now() - lastNativeGestureAtRef.current < NATIVE_GESTURE_WHEEL_SUPPRESS_MS;
      const isAppZoomScrollLocked = Date.now() < zoomScrollLockUntilRef.current;
      const isCanvasZoomInProgress =
        Boolean(activeZoomAnchorRef.current) ||
        zoomRafRef.current !== 0 ||
        zoomSettleTimerRef.current !== null ||
        zoomSnapAnimationRef.current !== 0;

      if (
        !isZoomWheel &&
        (isNativePinchWheelNoise || isAppZoomScrollLocked || isCanvasZoomInProgress)
      ) {
        consumeAppZoomWheelEvent(event);
        return;
      }

      if (!isZoomWheel) {
        if (shouldLetEditorHandleWheel(event)) {
          return;
        }

        if (appZoomRef.current > 1 && panZoomViewport(event.deltaX, event.deltaY)) {
          consumeAppZoomWheelEvent(event);
        }
        return;
      }

      if (isNativePinchWheelNoise) {
        consumeAppZoomWheelEvent(event);
        return;
      }

      lockAppZoomScroll();
      consumeAppZoomWheelEvent(event);
      const baseZoom = zoomRafRef.current ? pendingZoomRef.current : appZoomRef.current;
      const safeDeltaY = Math.max(
        -WHEEL_ZOOM_DELTA_LIMIT,
        Math.min(WHEEL_ZOOM_DELTA_LIMIT, event.deltaY),
      );
      scheduleZoomAtPoint(
        baseZoom * Math.exp(-safeDeltaY * WHEEL_ZOOM_SENSITIVITY),
        event.clientX,
        event.clientY,
      );
      scheduleZoomSettle(event.clientX, event.clientY);
    };

    const handleNativePinchPayload = (detail: NativePinchPayload) => {
      if (document.querySelector(".image-viewer-overlay, .mermaid-zoom-overlay")) {
        return;
      }

      lastNativeGestureAtRef.current = Date.now();
      lockAppZoomScroll();

      const delta = typeof detail.delta === "number" && Number.isFinite(detail.delta)
        ? detail.delta
        : typeof detail.magnification === "number" && Number.isFinite(detail.magnification)
          ? detail.magnification
          : 0;
      const scale = typeof detail.scale === "number" && Number.isFinite(detail.scale)
        ? detail.scale
        : null;
      const viewport = zoomViewportRef.current;
      const rect = viewport?.getBoundingClientRect();
      const focusX = typeof detail.x === "number" && Number.isFinite(detail.x)
        ? detail.x
        : rect
          ? rect.left + rect.width / 2
          : window.innerWidth / 2;
      const focusY = typeof detail.y === "number" && Number.isFinite(detail.y)
        ? detail.y
        : rect
          ? rect.top + rect.height / 2
          : window.innerHeight / 2;
      const baseZoom = zoomRafRef.current ? pendingZoomRef.current : appZoomRef.current;
      const nextZoom = Math.abs(delta) > 0.000001
        ? baseZoom * Math.exp(delta * NATIVE_PINCH_ZOOM_SENSITIVITY)
        : scale && scale > 0
          ? baseZoom * Math.pow(scale, NATIVE_PINCH_SCALE_SENSITIVITY)
          : baseZoom;

      if (isNativePinchEndPhase(detail.phase) || isNativePinchEndPhase(detail.state)) {
        scheduleZoomSettle(focusX, focusY);
        return;
      }

      scheduleZoomAtPoint(nextZoom, focusX, focusY);
      scheduleZoomSettle(focusX, focusY);
    };

    window.addEventListener("wheel", handleAppZoomWheel, {
      capture: true,
      passive: false,
    });
    let disposed = false;
    let unlistenNativePinch: UnlistenFn | null = null;
    void listen<NativePinchPayload>("polarbear-native-pinch", (event) => {
      handleNativePinchPayload(event.payload);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenNativePinch = unlisten;
    });

    return () => {
      disposed = true;
      window.removeEventListener("wheel", handleAppZoomWheel, { capture: true });
      unlistenNativePinch?.();
    };
  }, [
    lockAppZoomScroll,
    panZoomViewport,
    scheduleZoomAtPoint,
    scheduleZoomSettle,
  ]);

  useEffect(() => {
    void refreshRepositoryState();
  }, [workspaceRoot]);

  const updateActiveDocument = (value: string) => {
    if (!activeFileId) {
      setStatusMessage("Create or select a Markdown file before writing.");
      return;
    }

    setDocuments((currentDocuments) => ({
      ...currentDocuments,
      [activeFileId]: value,
    }));
    setDirtyFileIds((currentDirtyFileIds) => {
      const nextDirtyFileIds = new Set(currentDirtyFileIds);
      nextDirtyFileIds.add(activeFileId);
      return nextDirtyFileIds;
    });
  };

  const commitEditorZoom = useCallback((nextZoom: number) => {
    const zoom = clampEditorZoom(nextZoom);
    editorZoomRef.current = zoom;
    setEditorZoom((currentZoom) =>
      Math.abs(currentZoom - zoom) < 0.0005 ? currentZoom : zoom,
    );
    return zoom;
  }, []);

  const restoreContinuousZoomScroll = useCallback((session: ContinuousZoomSession, zoom: number) => {
    const target = resolveActiveDocumentZoomTarget(session.target.mode) ?? session.target;
    target.scrollport.scrollLeft = session.docX * zoom - session.focusX;
    target.scrollport.scrollTop = session.docY * zoom - session.focusY;
  }, []);

  const cancelActiveDocumentContinuousZoom = useCallback(() => {
    if (continuousZoomRafRef.current) {
      window.cancelAnimationFrame(continuousZoomRafRef.current);
      continuousZoomRafRef.current = 0;
    }

    if (continuousZoomRestoreFrameRef.current) {
      window.cancelAnimationFrame(continuousZoomRestoreFrameRef.current);
      continuousZoomRestoreFrameRef.current = 0;
    }

    if (continuousZoomSecondRestoreFrameRef.current) {
      window.cancelAnimationFrame(continuousZoomSecondRestoreFrameRef.current);
      continuousZoomSecondRestoreFrameRef.current = 0;
    }

    if (continuousZoomIdleTimerRef.current !== null) {
      window.clearTimeout(continuousZoomIdleTimerRef.current);
      continuousZoomIdleTimerRef.current = null;
    }

    pendingContinuousZoomRef.current = null;

    if (activeContinuousZoomRef.current) {
      cleanupActiveDocumentVisualZoom(activeContinuousZoomRef.current);
      activeContinuousZoomRef.current = null;
    }
  }, []);

  const finishActiveDocumentContinuousZoom = useCallback(() => {
    const session = activeContinuousZoomRef.current;
    if (!session) {
      return editorZoomRef.current;
    }

    if (continuousZoomRafRef.current) {
      window.cancelAnimationFrame(continuousZoomRafRef.current);
      continuousZoomRafRef.current = 0;
    }

    if (continuousZoomIdleTimerRef.current !== null) {
      window.clearTimeout(continuousZoomIdleTimerRef.current);
      continuousZoomIdleTimerRef.current = null;
    }

    pendingContinuousZoomRef.current = null;

    const oldZoom = editorZoomRef.current;
    const finalZoom = commitEditorZoom(session.visualZoom);
    scheduleEditorZoomDebug({
      mode: session.target.mode,
      nextZoom: finalZoom,
      oldZoom,
      source: session.input,
    });

    if (continuousZoomRestoreFrameRef.current) {
      window.cancelAnimationFrame(continuousZoomRestoreFrameRef.current);
    }

    if (continuousZoomSecondRestoreFrameRef.current) {
      window.cancelAnimationFrame(continuousZoomSecondRestoreFrameRef.current);
    }

    continuousZoomRestoreFrameRef.current = window.requestAnimationFrame(() => {
      restoreContinuousZoomScroll(session, finalZoom);
      cleanupActiveDocumentVisualZoom(session);
      if (activeContinuousZoomRef.current === session) {
        activeContinuousZoomRef.current = null;
      }

      continuousZoomSecondRestoreFrameRef.current = window.requestAnimationFrame(() => {
        restoreContinuousZoomScroll(session, finalZoom);
        continuousZoomSecondRestoreFrameRef.current = 0;
      });
      continuousZoomRestoreFrameRef.current = 0;
    });

    return finalZoom;
  }, [commitEditorZoom, restoreContinuousZoomScroll]);

  const resolveContinuousZoomFocus = useCallback((
    target: ActiveDocumentZoomTarget,
    input: ContinuousZoomInput,
    clientX?: number,
    clientY?: number,
  ): ContinuousZoomFocus => {
    const scrollportRect = target.scrollport.getBoundingClientRect();
    const hasClientPoint =
      typeof clientX === "number" &&
      Number.isFinite(clientX) &&
      typeof clientY === "number" &&
      Number.isFinite(clientY) &&
      clientX >= scrollportRect.left &&
      clientX <= scrollportRect.right &&
      clientY >= scrollportRect.top &&
      clientY <= scrollportRect.bottom;
    const lastPointer = lastPointerClientRef.current;
    const hasLastPointer =
      Boolean(lastPointer) &&
      lastPointer!.x >= scrollportRect.left &&
      lastPointer!.x <= scrollportRect.right &&
      lastPointer!.y >= scrollportRect.top &&
      lastPointer!.y <= scrollportRect.bottom;
    const focusClientX = hasClientPoint
      ? clientX!
      : hasLastPointer
        ? lastPointer!.x
        : scrollportRect.left + scrollportRect.width / 2;
    const focusClientY = hasClientPoint
      ? clientY!
      : hasLastPointer
        ? lastPointer!.y
        : scrollportRect.top + scrollportRect.height / 2;
    const focusSource: ContinuousZoomFocusSource = hasClientPoint
      ? input === "native-pinch"
        ? "native-pinch"
        : "wheel-client"
      : hasLastPointer
        ? "last-pointer"
        : "viewport-center";
    const focusX = focusClientX - scrollportRect.left;
    const focusY = focusClientY - scrollportRect.top;
    const baseZoom = Math.max(EDITOR_ZOOM_MIN, editorZoomRef.current);

    return {
      clientX: focusClientX,
      clientY: focusClientY,
      docX: (target.scrollport.scrollLeft + focusX) / baseZoom,
      docY: (target.scrollport.scrollTop + focusY) / baseZoom,
      focusSource,
      focusX,
      focusY,
    };
  }, []);

  const scheduleContinuousZoomFrame = useCallback((request: ContinuousZoomRequest) => {
    pendingContinuousZoomRef.current = request;

    if (continuousZoomRafRef.current) {
      return;
    }

    continuousZoomRafRef.current = window.requestAnimationFrame(() => {
      continuousZoomRafRef.current = 0;
      const nextRequest = pendingContinuousZoomRef.current;
      const session = activeContinuousZoomRef.current;
      pendingContinuousZoomRef.current = null;

      if (!nextRequest || !session) {
        return;
      }

      updateActiveDocumentVisualZoom(session, nextRequest.nextZoom);
    });
  }, []);

  const beginOrUpdateActiveDocumentContinuousZoom = useCallback((params: {
    clientX?: number;
    clientY?: number;
    factor: number;
    input: ContinuousZoomInput;
  }) => {
    const mode = toEditorZoomMode(viewMode);
    if (mode === "split") {
      setStatusMessage("Split Mode zoom is not implemented yet.");
      return editorZoomRef.current;
    }

    const target = resolveActiveDocumentZoomTarget(mode);
    if (!target) {
      console.table({
        adapterFound: false,
        event: "editor-zoom",
        input: params.input,
        mode,
        phase: "continuous-zoom-target",
        targetFound: false,
      });
      return editorZoomRef.current;
    }

    let session = activeContinuousZoomRef.current;
    if (!session || session.target.mode !== mode || !session.target.host.isConnected) {
      if (session) {
        cancelActiveDocumentContinuousZoom();
      }

      const focus = resolveContinuousZoomFocus(
        target,
        params.input,
        params.clientX,
        params.clientY,
      );
      session = beginActiveDocumentVisualZoom(
        target,
        focus,
        editorZoomRef.current,
        params.input,
      );
      activeContinuousZoomRef.current = session;
    }

    const currentZoom = session.visualZoom;
    const rawNextZoom = currentZoom * params.factor;
    const maxStep = 1.08;
    const step = Math.max(1 / maxStep, Math.min(maxStep, rawNextZoom / currentZoom));
    const nextZoom = clampEditorZoom(currentZoom * step);
    scheduleContinuousZoomFrame({
      input: params.input,
      nextZoom,
    });

    return nextZoom;
  }, [
    cancelActiveDocumentContinuousZoom,
    resolveContinuousZoomFocus,
    scheduleContinuousZoomFrame,
    viewMode,
  ]);

  useEffect(() => {
    cancelActiveDocumentContinuousZoom();
  }, [cancelActiveDocumentContinuousZoom, viewMode]);

  const applyEditorWorkspaceZoom = useCallback((
    nextZoom: number,
    options: {
      clientX?: number;
      clientY?: number;
      settleNow?: boolean;
      source?: EditorZoomDebugSource;
    } = {},
  ) => {
    const oldZoom = editorZoomRef.current;
    const zoom = clampEditorZoom(nextZoom);
    const mode = toEditorZoomMode(viewMode);
    const debugSource = options.source ?? "menu";

    if (mode === "split") {
      setStatusMessage("Split Mode zoom is not implemented yet.");
      scheduleEditorZoomDebug({
        mode,
        nextZoom: oldZoom,
        oldZoom,
        source: debugSource,
      });
      return editorZoomRef.current;
    }

    const committedZoom = commitEditorZoom(zoom);
    cancelActiveDocumentContinuousZoom();
    scheduleEditorZoomDebug({
      mode,
      nextZoom: committedZoom,
      oldZoom,
      source: debugSource,
    });
    return committedZoom;
  }, [cancelActiveDocumentContinuousZoom, commitEditorZoom, viewMode]);

  const zoomEditorAtWorkspaceCenter = useCallback((
    nextZoom: number,
    source: EditorZoomDebugSource = "menu",
  ) => {
    const workspace = document.querySelector(".editor-workspace");
    const rect = workspace instanceof HTMLElement
      ? workspace.getBoundingClientRect()
      : null;

    return applyEditorWorkspaceZoom(nextZoom, {
      clientX: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      clientY: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
      settleNow: true,
      source,
    });
  }, [applyEditorWorkspaceZoom]);

  const runAppZoomCommand = useCallback((action: "in" | "out" | "reset") => {
    cancelActiveDocumentContinuousZoom();
    cancelZoomSnapAnimation();

    if (!APP_CANVAS_ZOOM_ENABLED) {
      const manager = appZoomManagerRef.current;
      const zoomPromise =
        action === "in"
          ? manager?.zoomIn()
          : action === "out"
            ? manager?.zoomOut()
            : manager?.resetZoom();

      if (!zoomPromise) {
        setStatusMessage("App zoom is still starting.");
        return;
      }

      void zoomPromise.then((zoom) => {
        appZoomRef.current = zoom;
        setAppZoom((currentZoom) =>
          Math.abs(currentZoom - zoom) < 0.0005 ? currentZoom : zoom,
        );
        setAppCanvasZoomDataset(NORMAL_APP_ZOOM);
        delete document.documentElement.dataset.appCanvasZooming;
        setStatusMessage(`App zoom ${Math.round(zoom * 100)}%.`);
      }).catch((error) => {
        console.error("Failed to apply app zoom", error);
        setStatusMessage("Failed to apply app zoom.");
      });

      setEditorZoom(EDITOR_ZOOM_DEFAULT);
      editorZoomRef.current = EDITOR_ZOOM_DEFAULT;
      return;
    }

    const viewport = zoomViewportRef.current;
    const rect = viewport?.getBoundingClientRect();
    const fallbackClientX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const fallbackClientY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const clientX = lastPointerClientRef.current?.x ?? fallbackClientX;
    const clientY = lastPointerClientRef.current?.y ?? fallbackClientY;
    const nextZoom =
      action === "in"
        ? appZoomRef.current + APP_ZOOM_STEP
        : action === "out"
          ? appZoomRef.current - APP_ZOOM_STEP
          : NORMAL_APP_ZOOM;
    const zoom = clampCommittedZoom(nextZoom);

    if (!viewport) {
      applyCanvasZoom(zoom, false);
      commitZoom(zoom);
    } else {
      const anchor = getAnchorCanvasPoint(viewport, appZoomRef.current, clientX, clientY);
      applyZoomAtAnchor(zoom, anchor, false);
      commitZoom(zoom);
    }

    setEditorZoom(EDITOR_ZOOM_DEFAULT);
    editorZoomRef.current = EDITOR_ZOOM_DEFAULT;
    setStatusMessage(`App zoom ${Math.round(zoom * 100)}%.`);
  }, [
    applyCanvasZoom,
    applyZoomAtAnchor,
    cancelActiveDocumentContinuousZoom,
    cancelZoomSnapAnimation,
    commitZoom,
    getAnchorCanvasPoint,
  ]);

  useEffect(() => {
    if (!EDITOR_WORKSPACE_ZOOM_ENABLED) {
      return undefined;
    }

    const isInsideEditorWorkspace = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest(".editor-workspace"));

    const handleEditorZoomWheel = (event: WheelEvent) => {
      if (shouldIgnoreAppZoomEvent(event) || !isInsideEditorWorkspace(event.target)) {
        return;
      }

      if (!isAppZoomWheelEvent(event)) {
        return;
      }

      if (Date.now() - lastEditorNativeGestureAtRef.current < NATIVE_GESTURE_WHEEL_SUPPRESS_MS) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const safeDeltaY = Math.max(
        -WHEEL_ZOOM_DELTA_LIMIT,
        Math.min(WHEEL_ZOOM_DELTA_LIMIT, event.deltaY),
      );
      beginOrUpdateActiveDocumentContinuousZoom({
        clientX: event.clientX,
        clientY: event.clientY,
        factor: Math.exp(-safeDeltaY * WHEEL_ZOOM_SENSITIVITY),
        input: "wheel",
      });

      if (continuousZoomIdleTimerRef.current !== null) {
        window.clearTimeout(continuousZoomIdleTimerRef.current);
      }
      continuousZoomIdleTimerRef.current = window.setTimeout(() => {
        continuousZoomIdleTimerRef.current = null;
        finishActiveDocumentContinuousZoom();
      }, 220);
    };

    const handleEditorNativePinch = (event: Event) => {
      if (shouldIgnoreAppZoomEvent(event)) {
        return;
      }

      const workspace = document.querySelector(".editor-workspace");
      if (!(workspace instanceof HTMLElement)) {
        return;
      }

      const pinchEvent = event as NativePinchEventLike;
      const detail = pinchEvent.detail ?? {};
      const workspaceRect = workspace.getBoundingClientRect();
      const focusX = typeof detail.x === "number" && Number.isFinite(detail.x)
        ? detail.x
        : workspaceRect.left + workspaceRect.width / 2;
      const focusY = typeof detail.y === "number" && Number.isFinite(detail.y)
        ? detail.y
        : workspaceRect.top + workspaceRect.height / 2;

      if (
        focusX < workspaceRect.left ||
        focusX > workspaceRect.right ||
        focusY < workspaceRect.top ||
        focusY > workspaceRect.bottom
      ) {
        return;
      }

      lastEditorNativeGestureAtRef.current = Date.now();

      const delta = typeof detail.delta === "number" && Number.isFinite(detail.delta)
        ? detail.delta
        : typeof detail.magnification === "number" && Number.isFinite(detail.magnification)
          ? detail.magnification
          : 0;
      const scale = typeof detail.scale === "number" && Number.isFinite(detail.scale)
        ? detail.scale
        : null;

      if (isNativePinchEndPhase(detail.phase) || isNativePinchEndPhase(detail.state)) {
        finishActiveDocumentContinuousZoom();
        return;
      }

      const factor = Math.abs(delta) > 0.000001
        ? Math.exp(delta * NATIVE_PINCH_ZOOM_SENSITIVITY)
        : scale && scale > 0
          ? Math.pow(scale, NATIVE_PINCH_SCALE_SENSITIVITY)
          : 1;

      if (Math.abs(factor - 1) < 0.000001) {
        return;
      }

      beginOrUpdateActiveDocumentContinuousZoom({
        clientX: focusX,
        clientY: focusY,
        factor,
        input: "native-pinch",
      });

      if (continuousZoomIdleTimerRef.current !== null) {
        window.clearTimeout(continuousZoomIdleTimerRef.current);
      }
      continuousZoomIdleTimerRef.current = window.setTimeout(() => {
        continuousZoomIdleTimerRef.current = null;
        finishActiveDocumentContinuousZoom();
      }, 220);
    };

    window.addEventListener("wheel", handleEditorZoomWheel, {
      capture: true,
      passive: false,
    });
    window.addEventListener("polarbear-native-pinch", handleEditorNativePinch as EventListener);

    return () => {
      window.removeEventListener("wheel", handleEditorZoomWheel, { capture: true });
      window.removeEventListener("polarbear-native-pinch", handleEditorNativePinch as EventListener);
    };
  }, [beginOrUpdateActiveDocumentContinuousZoom, finishActiveDocumentContinuousZoom]);

  const loadWorkspace = async (nextWorkspaceRoot: string): Promise<boolean> => {
    try {
      const items = await listWorkspaceFiles(nextWorkspaceRoot);
      const firstFile = findFirstFile(items);

      setWorkspaceRoot(nextWorkspaceRoot);
      setWorkspaceItems(items);
      setDocuments({});
      setDirtyFileIds(new Set());
      setSelectedTreeItemId("");
      setStatusMessage(`Opened workspace: ${nextWorkspaceRoot}`);

      if (firstFile) {
        const source = await loadMarkdownFile({
          workspaceRoot: nextWorkspaceRoot,
          relativePath: firstFile.id,
        });
        setDocuments({ [firstFile.id]: source });
        setActiveFileId(firstFile.id);
        setSelectedTreeItemId(firstFile.id);
      } else {
        setActiveFileId("");
      }

      return true;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const openWorkspace = async () => {
    try {
      const selectedFolder = await chooseWorkspaceFolder();

      if (!selectedFolder) {
        setStatusMessage("Open workspace cancelled.");
        return;
      }

      void loadWorkspace(selectedFolder);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openFile = async () => {
    try {
      const selectedFile = await chooseMarkdownFile();

      if (!selectedFile) {
        setStatusMessage("Open file cancelled.");
        return;
      }

      const openedFile = await openMarkdownFile(selectedFile);
      setWorkspaceRoot(openedFile.workspaceRoot);
      setWorkspaceItems(openedFile.tree);
      setDocuments({ [openedFile.relativePath]: openedFile.markdownContent });
      setActiveFileId(openedFile.relativePath);
      setSelectedTreeItemId(openedFile.relativePath);
      setDirtyFileIds(new Set());
      setStatusMessage(`Opened ${openedFile.relativePath}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshRepositoryState = async () => {
    try {
      const account = await getRepositoryAccount();
      const binding = workspaceRoot
        ? await getWorkspaceRepositoryBinding(workspaceRoot)
        : null;

      setRepositoryAccount(account);
      setRepositoryBinding(binding);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const connectGithub = async (token: string) => {
    setIsRepositoryBusy(true);

    try {
      const account = await validateGithubToken(token);
      setRepositoryAccount(account);
      setRepositoryDialog(null);
      setStatusMessage(`Connected GitHub as ${account.login}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const disconnectGithubAccount = async () => {
    setIsRepositoryBusy(true);

    try {
      await disconnectGithub();
      setRepositoryAccount(null);
      setRepositoryBinding(null);
      setRepositoryDialog(null);
      setStatusMessage("Disconnected GitHub.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const openLinkWorkspaceDialog = async () => {
    if (!workspaceRoot) {
      setStatusMessage("Open a workspace before linking a repository.");
      return;
    }

    if (!repositoryAccount) {
      setRepositoryDialog("connect");
      return;
    }

    setIsRepositoryBusy(true);

    try {
      const repositories = await listGithubRepositories();
      setGithubRepositories(repositories);
      setRepositoryDialog("link");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const linkCurrentWorkspace = async (params: {
    owner: string;
    repo: string;
    branch: string;
    remotePath: string;
  }) => {
    if (!workspaceRoot) {
      setStatusMessage("Open a workspace before linking a repository.");
      return;
    }

    setIsRepositoryBusy(true);

    try {
      const binding = await linkWorkspaceToGithub({
        workspaceRef: workspaceRoot,
        ...params,
      });
      setRepositoryBinding(binding);
      setRepositoryDialog(null);
      setStatusMessage(`Linked workspace to ${binding.owner}/${binding.repo}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const refreshSyncStatus = async () => {
    if (!workspaceRoot) {
      setStatusMessage("Open a workspace before viewing sync status.");
      return;
    }

    setIsRepositoryBusy(true);

    try {
      const status = await getRepositorySyncStatus({
        workspaceRef: workspaceRoot,
        dirty: dirtyFileIds.size > 0,
      });
      setRepositorySyncStatus(status);
      setRepositoryAccount(status.account ?? null);
      setRepositoryBinding(status.binding ?? null);
      setRepositoryDialog("status");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const runRepositorySyncAction = async (action: "pull" | "push" | "sync") => {
    if (!workspaceRoot) {
      setStatusMessage("Open a workspace before syncing.");
      return;
    }

    setIsRepositoryBusy(true);

    try {
      const params = {
        workspaceRef: workspaceRoot,
        dirty: dirtyFileIds.size > 0,
      };
      const status =
        action === "pull"
          ? await pullWorkspace(params)
          : action === "push"
            ? await pushWorkspace(params)
            : await syncWorkspaceNow(params);

      setRepositorySyncStatus(status);
      setRepositoryAccount(status.account ?? null);
      setRepositoryBinding(status.binding ?? null);
      if (action === "pull" || action === "sync") {
        setWorkspaceItems(await listWorkspaceFiles(workspaceRoot));
      }
      setStatusMessage(`Repository ${action} completed.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const createUntitledDocument = () => {
    const nextUntitledNumber = untitledCounter + 1;
    const title =
      nextUntitledNumber === 1 ? "Untitled" : `Untitled ${nextUntitledNumber}`;
    const documentId = `untitled:${nextUntitledNumber}`;

    setUntitledCounter(nextUntitledNumber);
    setDocuments((currentDocuments) => ({
      ...currentDocuments,
      [documentId]: "",
    }));
    setDocumentTitles((currentTitles) => ({
      ...currentTitles,
      [documentId]: title,
    }));
    setActiveFileId(documentId);
    setDirtyFileIds((currentDirtyFileIds) => {
      const nextDirtyFileIds = new Set(currentDirtyFileIds);
      nextDirtyFileIds.add(documentId);
      return nextDirtyFileIds;
    });
    setStatusMessage(`Created ${title}`);
  };

  const selectFile = async (fileId: string) => {
    setActiveFileId(fileId);
    setSelectedTreeItemId(fileId);

    if (!workspaceRoot || documents[fileId] !== undefined) {
      return;
    }

    try {
      const source = await loadMarkdownFile({
        workspaceRoot,
        relativePath: fileId,
      });
      setDocuments((currentDocuments) => ({
        ...currentDocuments,
        [fileId]: source,
      }));
      setStatusMessage(`Loaded ${fileId}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const saveActiveFile = async () => {
    if (isUntitledDocument(activeFileId)) {
      await saveActiveFileAs();
      return;
    }

    if (!workspaceRoot) {
      setStatusMessage("Open a local workspace before saving to disk.");
      return;
    }

    if (!activeFileId) {
      setStatusMessage("Create or select a Markdown file before saving.");
      return;
    }

    try {
      await saveMarkdownFile({
        workspaceRoot,
        relativePath: activeFileId,
        markdownContent,
      });
      setDirtyFileIds((currentDirtyFileIds) => {
        const nextDirtyFileIds = new Set(currentDirtyFileIds);
        nextDirtyFileIds.delete(activeFileId);
        return nextDirtyFileIds;
      });
      setStatusMessage(`Saved ${activeFileId}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const saveActiveFileAs = async () => {
    if (!activeFileId) {
      setStatusMessage("Create or select a Markdown file before saving.");
      return;
    }

    try {
      const defaultFileName = deriveDefaultMarkdownFileName(
        markdownContent,
        activeFileName,
      );
      const selectedPath = await chooseMarkdownSavePath(defaultFileName);

      if (!selectedPath) {
        setStatusMessage("Save cancelled.");
        return;
      }

      const markdownFilePath = ensureMarkdownFilePath(selectedPath);
      await writeMarkdownFile({
        filePath: markdownFilePath,
        markdownContent,
      });

      const workspacePath = parentPathOf(markdownFilePath);
      const relativePath = fileNameOf(markdownFilePath);
      const items = await listWorkspaceFiles(workspacePath);

      setWorkspaceRoot(workspacePath);
      setWorkspaceItems(items);
      setDocuments((currentDocuments) => {
        const nextDocuments = { ...currentDocuments };
        delete nextDocuments[activeFileId];
        nextDocuments[relativePath] = markdownContent;
        return nextDocuments;
      });
      setDocumentTitles((currentTitles) => {
        const nextTitles = { ...currentTitles };
        delete nextTitles[activeFileId];
        return nextTitles;
      });
      setActiveFileId(relativePath);
      setDirtyFileIds((currentDirtyFileIds) => {
        const nextDirtyFileIds = new Set(currentDirtyFileIds);
        nextDirtyFileIds.delete(activeFileId);
        return nextDirtyFileIds;
      });
      setStatusMessage(`Saved ${relativePath}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const revealFolder = (folderId: string | null) => {
    if (!folderId) {
      return;
    }

    setFolderRevealRequest((currentRequest) => ({
      folderId,
      version: (currentRequest?.version ?? 0) + 1,
    }));
  };

  const createFile = async (fileName: string) => {
    const relativePath = joinWorkspacePath(
      createParentPath,
      normalizeMarkdownFileName(fileName),
    );

    if (!relativePath) {
      setStatusMessage("File name cannot be empty.");
      return;
    }

    if (!workspaceRoot) {
      setStatusMessage("Open a local workspace before creating files.");
      return;
    }

    try {
      await createMarkdownFile({
        workspaceRoot,
        relativePath,
      });
      const items = await listWorkspaceFiles(workspaceRoot);
      const source = await loadMarkdownFile({
        workspaceRoot,
        relativePath,
      });

      setWorkspaceItems(items);
      setDocuments((currentDocuments) => ({
        ...currentDocuments,
        [relativePath]: source,
      }));
      setActiveFileId(relativePath);
      setSelectedTreeItemId(relativePath);
      revealFolder(createParentPath);
      setStatusMessage(`Created ${relativePath}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const createFolder = async (folderName: string) => {
    const relativePath = joinWorkspacePath(
      createParentPath,
      normalizeWorkspacePath(folderName),
    );

    if (!relativePath) {
      setStatusMessage("Folder name cannot be empty.");
      return;
    }

    if (!workspaceRoot) {
      setStatusMessage("Open a local workspace before creating folders.");
      return;
    }

    try {
      await createWorkspaceDirectory({
        workspaceRoot,
        relativePath,
      });
      setWorkspaceItems(await listWorkspaceFiles(workspaceRoot));
      setSelectedTreeItemId(relativePath);
      revealFolder(createParentPath);
      setStatusMessage(`Created folder ${relativePath}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openCreateDialog = async (
    itemType: CreateItemType,
    parentPath?: string,
  ) => {
    if (!workspaceRoot) {
      setStatusMessage("Choose a local workspace folder first.");

      try {
        const selectedFolder = await chooseWorkspaceFolder();

        if (!selectedFolder) {
          setStatusMessage("Create cancelled. No workspace folder selected.");
          return;
        }

        const didOpenWorkspace = await loadWorkspace(selectedFolder);
        if (!didOpenWorkspace) {
          return;
        }
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
    }

    setCreateParentPath(parentPath ?? null);
    setCreateItemType(itemType);
  };

  const createDefaultName =
    createItemType === "file" ? "example.md" : "New Folder";

  const confirmCreateItem = async (name: string) => {
    const itemType = createItemType;

    setCreateItemType(null);
    setCreateParentPath(null);

    if (itemType === "file") {
      await createFile(name);
    }

    if (itemType === "folder") {
      await createFolder(name);
    }
  };

  const startRename = (targetPath?: string) => {
    const targetId = targetPath ?? (selectedTreeItemId || activeFileId);
    const targetItem = findWorkspaceItem(workspaceItems, targetId);

    if (!targetItem) {
      setStatusMessage("Select a file or folder before renaming.");
      return;
    }

    if (targetAffectsDirtyFile(targetItem.id, dirtyFileIds)) {
      setStatusMessage("Save the current file before renaming.");
      return;
    }

    setRenameItemId(targetItem.id);
  };

  const confirmRename = async (item: WorkspaceItem, nextName: string) => {
    if (!workspaceRoot) {
      return;
    }

    if (targetAffectsDirtyFile(item.id, dirtyFileIds)) {
      setStatusMessage("Save the current file before renaming.");
      return;
    }

    try {
      const response = await renameEntry({
        workspaceRoot,
        sourceRelativePath: item.id,
        newName: nextName,
      });
      const items = await listWorkspaceFiles(workspaceRoot);

      setWorkspaceItems(items);
      setRenameItemId(null);
      setDocuments((currentDocuments) =>
        remapDocumentPaths(
          currentDocuments,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setDirtyFileIds((currentDirtyFileIds) =>
        remapDirtyFileIds(
          currentDirtyFileIds,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setActiveFileId((currentActiveFileId) =>
        remapPath(
          currentActiveFileId,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setSelectedTreeItemId((currentSelectedItemId) =>
        remapPath(
          currentSelectedItemId,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setStatusMessage(
        `Renamed ${response.oldRelativePath} to ${response.newRelativePath}`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const moveWorkspaceEntry = async (
    sourcePath: string,
    targetParentPath: string | null,
  ) => {
    if (!workspaceRoot) {
      setStatusMessage("Open a workspace before moving files.");
      return;
    }

    if (targetAffectsDirtyFile(sourcePath, dirtyFileIds)) {
      setStatusMessage("Save the current file before moving it.");
      return;
    }

    try {
      const response = await moveEntry({
        workspaceRoot,
        sourceRelativePath: sourcePath,
        targetParentRelativePath: targetParentPath,
      });
      const items = await listWorkspaceFiles(workspaceRoot);

      setWorkspaceItems(items);
      setDocuments((currentDocuments) =>
        remapDocumentPaths(
          currentDocuments,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setDirtyFileIds((currentDirtyFileIds) =>
        remapDirtyFileIds(
          currentDirtyFileIds,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setActiveFileId((currentActiveFileId) =>
        remapPath(
          currentActiveFileId,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setSelectedTreeItemId((currentSelectedItemId) =>
        remapPath(
          currentSelectedItemId,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      revealFolder(targetParentPath);
      setStatusMessage(
        `Moved ${response.oldRelativePath} to ${response.newRelativePath}`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const formatMarkdown = (command: AppCommand) => {
    const editorView = editorViewRef.current;

    if (!editorView) {
      setStatusMessage("Focus the Markdown editor before formatting.");
      return;
    }

    const text = editorView.state.doc.toString();
    const selection = editorView.state.selection.main;
    const edit = applyMarkdownFormat(command, text, selection);

    if (!edit) {
      return;
    }

    editorView.dispatch({
      changes: {
        from: 0,
        to: text.length,
        insert: edit.nextText,
      },
      selection: {
        anchor: edit.selectionAnchor,
        head: edit.selectionHead,
      },
      scrollIntoView: false,
    });
    editorView.focus();
  };

  const insertMarkdownAtSelection = (insertText: string) => {
    const editorView = editorViewRef.current;

    if (!activeFileId) {
      setStatusMessage("Open a Markdown document before inserting content.");
      return;
    }

    if (!editorView) {
      const nextMarkdownContent = `${markdownContent.replace(/\s*$/, "\n\n")}${insertText.trimStart()}`;
      updateActiveDocument(nextMarkdownContent);
      return;
    }

    const selection = editorView.state.selection.main;
    editorView.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: insertText,
      },
      selection: {
        anchor: selection.from + insertText.length,
      },
      scrollIntoView: true,
    });
    editorView.focus();
  };

  const insertTable = (columns: number, rows: number) => {
    const header = `| ${Array.from({ length: columns }, (_, index) => `Column ${index + 1}`).join(" | ")} |`;
    const separator = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`;
    const body = Array.from(
      { length: rows },
      () => `| ${Array.from({ length: columns }, () => " ").join(" | ")} |`,
    ).join("\n");

    insertMarkdownAtSelection(`\n${header}\n${separator}\n${body}\n`);
    setIsInsertTableDialogOpen(false);
  };

  const insertCodeFence = (language: string) => {
    const template = codeFenceTemplate(language);
    insertMarkdownAtSelection(template);
    setIsInsertCodeFenceDialogOpen(false);
  };

  const runEditorSearchCommand = (
    command: "edit.find" | "edit.findNext" | "edit.findPrevious",
  ) => {
    if (!editorViewRef.current) {
      setStatusMessage("Focus the Markdown editor before searching.");
      return;
    }

    const editorView = editorViewRef.current as unknown as EditorView;
    const didRun =
      command === "edit.find"
        ? openSearchPanel(editorView)
        : command === "edit.findNext"
          ? findNext(editorView)
          : findPrevious(editorView);

    if (!didRun) {
      setStatusMessage("Search is unavailable in this editor state.");
    }
  };

  const ensureSavedMarkdownAssetTarget = async (): Promise<boolean> => {
    if (!activeFileId || isUntitledDocument(activeFileId)) {
      setStatusMessage("Save this document before inserting images.");
      return false;
    }

    if (!workspaceRoot) {
      setStatusMessage("Open a workspace before inserting images.");
      return false;
    }

    return true;
  };

  const insertImageFromPath = async (sourcePath: string) => {
    if (!(await ensureSavedMarkdownAssetTarget())) {
      return;
    }

    try {
      const asset = await copyImageAsset({
        workspaceRoot,
        markdownRelativePath: activeFileId,
        sourcePath,
      });
      insertMarkdownAtSelection(`${asset.markdownInsertText}\n`);
      setStatusMessage(`Inserted ${asset.assetRelativePath}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const insertImageFromDialog = async () => {
    if (!(await ensureSavedMarkdownAssetTarget())) {
      return;
    }

    try {
      const imagePath = await chooseImageFile();
      if (imagePath) {
        await insertImageFromPath(imagePath);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const pasteImageItems = async (
    items: DataTransferItemList,
    insertMarkdown?: (markdown: string) => void,
  ) => {
    if (!(await ensureSavedMarkdownAssetTarget())) {
      return;
    }

    const imageItem = [...items].find((item) => item.type.startsWith("image/"));
    const imageFile = imageItem?.getAsFile();

    if (!imageFile) {
      return;
    }

    try {
      const bytes = [...new Uint8Array(await imageFile.arrayBuffer())];
      const extension = imageFile.type.split("/").at(-1) ?? "png";
      const asset = await saveImageAsset({
        workspaceRoot,
        markdownRelativePath: activeFileId,
        fileName: `image-${timestampForFileName()}.${extension}`,
        imageBytes: bytes,
        extension,
      });
      const imageMarkdown = `${asset.markdownInsertText}\n`;
      if (insertMarkdown) {
        insertMarkdown(imageMarkdown);
      } else {
        insertMarkdownAtSelection(imageMarkdown);
      }
      setStatusMessage(`Inserted ${asset.assetRelativePath}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const executeCommand = useCallback(
    (command: AppCommand, payload?: AppCommandPayload) => {
      const targetPath = payload?.targetPath;
      const targetItem = targetPath
        ? findWorkspaceItem(workspaceItems, targetPath)
        : null;
      const parentPath = targetItem?.type === "folder" ? targetItem.id : null;
      const commandTargetPath = targetPath ?? activeFileId;

      if (command === "file.newFile") {
        if (payload?.workspaceCreate) {
          void openCreateDialog("file", parentPath ?? undefined);
        } else {
          createUntitledDocument();
        }
        return;
      }

      if (command === "file.newFolder") {
        void openCreateDialog("folder", parentPath ?? undefined);
        return;
      }

      if (command === "file.openFile") {
        if (targetItem?.type === "file") {
          void selectFile(targetItem.id);
        } else {
          void openFile();
        }
        return;
      }

      if (command === "file.openFolder") {
        void openWorkspace();
        return;
      }

      if (command === "file.save") {
        void saveActiveFile();
        return;
      }

      if (command === "file.saveAs") {
        void saveActiveFileAs();
        return;
      }

      if (command === "file.close") {
        if (!activeFileId) {
          return;
        }

        if (dirtyFileIds.has(activeFileId)) {
          setStatusMessage("Save the current file before closing it.");
          return;
        }

        setDocuments((currentDocuments) => {
          const nextDocuments = { ...currentDocuments };
          delete nextDocuments[activeFileId];
          return nextDocuments;
        });
        setActiveFileId("");
        setSelectedTreeItemId("");
        editorViewRef.current = null;
        setStatusMessage(`Closed ${activeFileName}`);
        return;
      }

      if (command === "format.insertImage") {
        void insertImageFromDialog();
        return;
      }

      if (command === "editor.insertTable") {
        setIsInsertTableDialogOpen(true);
        return;
      }

      if (command === "editor.insertCodeFence") {
        setIsInsertCodeFenceDialogOpen(true);
        return;
      }

      if (command === "file.rename") {
        startRename(commandTargetPath);
        return;
      }

      if (command === "file.move") {
        const sourcePath = payload?.sourcePath;
        const targetParentPath = payload?.targetParentPath ?? null;

        if (!sourcePath) {
          setStatusMessage("Select a file or folder before moving.");
          return;
        }

        void moveWorkspaceEntry(sourcePath, targetParentPath);
        return;
      }

      if (command === "file.revealInFinder") {
        if (!workspaceRoot) {
          setStatusMessage("Open a workspace before revealing it.");
          return;
        }

        void revealInFileManager({
          workspaceRoot,
          relativePath: commandTargetPath,
        }).catch((error: unknown) =>
          setStatusMessage(
            error instanceof Error ? error.message : String(error),
          ),
        );
        return;
      }

      if (command === "file.copyPath") {
        const pathToCopy = commandTargetPath
          ? `${workspaceRoot.replace(/[\\/]$/, "")}/${commandTargetPath}`
          : workspaceRoot;

        void navigator.clipboard
          .writeText(pathToCopy)
          .then(() => setStatusMessage("Copied path."))
          .catch((error: unknown) =>
            setStatusMessage(
              error instanceof Error ? error.message : String(error),
            ),
          );
        return;
      }

      if (command === "workspace.refresh") {
        if (workspaceRoot) {
          void loadWorkspace(workspaceRoot);
        }
        return;
      }

      if (command === "workspace.collapseAll") {
        setCollapseVersion((version) => version + 1);
        return;
      }

      if (command === "view.toggleSidebar") {
        setSidebarOpen((isOpen) => !isOpen);
        return;
      }

      if (command === "view.fileTree") {
        if (!workspaceRoot) {
          void openWorkspace();
        } else {
          setSidebarOpen(true);
        }
        return;
      }

      if (command === "view.edit") {
        setViewMode("edit");
        return;
      }

      if (command === "view.sourceCode") {
        setViewMode("edit");
        return;
      }

      if (command === "view.liveEdit") {
        setViewMode("live");
        return;
      }

      if (command === "view.split") {
        setViewMode("split");
        return;
      }

      if (command === "view.preview") {
        setViewMode("preview");
        return;
      }

      if (command === "view.zoomIn") {
        runAppZoomCommand("in");
        return;
      }

      if (command === "view.zoomOut") {
        runAppZoomCommand("out");
        return;
      }

      if (command === "view.resetZoom") {
        runAppZoomCommand("reset");
        return;
      }

      if (command === "theme.light") {
        setThemeName("light");
        setStatusMessage("Theme changed to Light.");
        return;
      }

      if (command === "theme.dark") {
        setThemeName("dark");
        setStatusMessage("Theme changed to Dark.");
        return;
      }

      if (
        command === "edit.find" ||
        command === "edit.findNext" ||
        command === "edit.findPrevious"
      ) {
        runEditorSearchCommand(command);
        return;
      }

      if (command === "repository.connectGithub") {
        setRepositoryDialog("connect");
        return;
      }

      if (command === "repository.disconnectGithub") {
        void disconnectGithubAccount();
        return;
      }

      if (command === "repository.linkWorkspace") {
        void openLinkWorkspaceDialog();
        return;
      }

      if (command === "repository.viewSyncStatus") {
        void refreshSyncStatus();
        return;
      }

      if (command === "repository.pushWorkspace") {
        void runRepositorySyncAction("push");
        return;
      }

      if (command === "repository.pullWorkspace") {
        void runRepositorySyncAction("pull");
        return;
      }

      if (command === "repository.syncNow") {
        void runRepositorySyncAction("sync");
        return;
      }

      if (command.startsWith("format.")) {
        formatMarkdown(command);
        return;
      }

      setStatusMessage(
        `${command} is reserved for a future Polarbear version.`,
      );
    },
    [
      activeFileId,
      activeFileName,
      dirtyFileIds,
      markdownContent,
      repositoryAccount,
      repositoryBinding,
      runAppZoomCommand,
      selectedTreeItemId,
      untitledCounter,
      workspaceItems,
      workspaceRoot,
    ],
  );

  useAppShortcuts(executeCommand);
  useNativeAppMenu(executeCommand, {
    repositoryAccount,
    repositoryBinding,
  });

  const shouldUseAppCanvasZoom = APP_CANVAS_ZOOM_ENABLED && !EDITOR_WORKSPACE_ZOOM_ENABLED;
  const renderedAppZoom = shouldUseAppCanvasZoom
    ? appZoomRef.current
    : NORMAL_APP_ZOOM;
  const renderedCanvasPlacement = shouldUseAppCanvasZoom
    ? appCanvasPlacementRef.current
    : null;
  const appZoomCanvasSizeStyle = {
    width: shouldUseAppCanvasZoom
      ? `${renderedCanvasPlacement?.canvasWidth ?? Math.ceil(appCanvasSize.width * renderedAppZoom)}px`
      : "100%",
    height: shouldUseAppCanvasZoom
      ? `${renderedCanvasPlacement?.canvasHeight ?? Math.ceil(appCanvasSize.height * renderedAppZoom)}px`
      : "100%",
  } satisfies CSSProperties;

  const appZoomCanvasStyle = {
    left: `${renderedCanvasPlacement?.offsetLeft ?? 0}px`,
    top: `${renderedCanvasPlacement?.offsetTop ?? 0}px`,
    width: shouldUseAppCanvasZoom ? `${appCanvasSize.width}px` : "100%",
    height: shouldUseAppCanvasZoom ? `${appCanvasSize.height}px` : "100%",
    transform: shouldUseAppCanvasZoom ? `scale(${renderedAppZoom})` : "none",
  } satisfies CSSProperties;

  return (
    <>
      <div ref={zoomViewportRef} className="app-zoom-viewport">
        <div
          ref={zoomCanvasSizeRef}
          className="app-zoom-canvas-size"
          style={appZoomCanvasSizeStyle}
        >
          <div
            ref={zoomCanvasRef}
            className="app-zoom-canvas"
            style={appZoomCanvasStyle}
          >
            <AppShell
              activeFileId={activeFileId}
              activeFileName={activeFileName}
              characterCount={markdownContent.length}
              collapseVersion={collapseVersion}
              dirtyFileIds={dirtyFileIds}
              executeCommand={executeCommand}
              folderRevealRequest={folderRevealRequest}
              isDirty={isDirty}
              renameItemId={renameItemId}
              selectedTreeItemId={selectedTreeItemId}
              sidebarOpen={sidebarOpen}
              statusMessage={statusMessage}
              workspaceRoot={workspaceRoot}
              workspaceItems={workspaceItems}
              onRenameCancel={() => setRenameItemId(null)}
              onRenameConfirm={(item, nextName) => void confirmRename(item, nextName)}
              onSelectFile={(fileId) => void selectFile(fileId)}
              onSelectTreeItem={setSelectedTreeItemId}
              onSidebarClose={() => setSidebarOpen(false)}
            >
              <section className={`editor-workspace editor-workspace-${viewMode}`}>
                {!activeFileId && !workspaceRoot ? (
                  <section className="editor-empty-state">
                    <h1>Polarbear</h1>
                    <p>
                      A local-first Markdown editor. Open a folder to start writing
                      with your local Markdown files.
                    </p>
                    <p className="empty-state-hint">
                      Use File / Open... or File / New.
                    </p>
                  </section>
                ) : workspaceRoot && !activeFileId ? (
                  <section className="editor-empty-state">
                    <h2>This workspace has no Markdown files.</h2>
                    <p>
                      Use the File menu or right-click the file tree to create one.
                    </p>
                  </section>
                ) : (
                  <>
                    {viewMode === "edit" || viewMode === "split" ? (
                      <MarkdownEditor
                        activeFileName={activeFileName}
                        markdownContent={markdownContent}
                        zoom={EDITOR_ZOOM_DEFAULT}
                        onEditorReady={(editorView) => {
                          editorViewRef.current = editorView;
                        }}
                        onImageDrop={(filePaths) => {
                          filePaths.forEach(
                            (filePath) => void insertImageFromPath(filePath),
                          );
                        }}
                        onImagePaste={(items: DataTransferItemList) => {
                          void pasteImageItems(items);
                        }}
                        onMarkdownChange={updateActiveDocument}
                      />
                    ) : null}
                    {viewMode === "live" ? (
                      <TyporaLiveEditor
                        activeFileId={activeFileId}
                        activeFileName={activeFileName}
                        markdownContent={markdownContent}
                        onEditorReady={(editorView) => {
                          editorViewRef.current = editorView;
                        }}
                        onImagePaste={(
                          items: DataTransferItemList,
                          insertMarkdown?: (markdown: string) => void,
                        ) => {
                          void pasteImageItems(items, insertMarkdown);
                        }}
                        onImageDrop={(filePaths) => {
                          filePaths.forEach(
                            (filePath) => void insertImageFromPath(filePath),
                          );
                        }}
                        onMarkdownChange={updateActiveDocument}
                        workspaceRoot={workspaceRoot}
                        zoom={EDITOR_ZOOM_DEFAULT}
                      />
                    ) : null}
                    {viewMode === "preview" || viewMode === "split" ? (
                      <MarkdownPreview
                        activeFileId={activeFileId}
                        activeFileName={activeFileName}
                        markdownContent={markdownContent}
                        workspaceRoot={workspaceRoot}
                        zoom={EDITOR_ZOOM_DEFAULT}
                      />
                    ) : null}
                  </>
                )}
              </section>
            </AppShell>
          </div>
        </div>
      </div>
      {createItemType ? (
        <CreateItemDialog
          defaultName={createDefaultName}
          itemType={createItemType}
          onCancel={() => {
            setCreateItemType(null);
            setCreateParentPath(null);
          }}
          onConfirm={(name) => void confirmCreateItem(name)}
        />
      ) : null}
      {isInsertTableDialogOpen ? (
        <InsertTableDialog
          onCancel={() => setIsInsertTableDialogOpen(false)}
          onConfirm={insertTable}
        />
      ) : null}
      {isInsertCodeFenceDialogOpen ? (
        <InsertCodeFenceDialog
          onCancel={() => setIsInsertCodeFenceDialogOpen(false)}
          onConfirm={insertCodeFence}
        />
      ) : null}
      {repositoryDialog === "connect" ? (
        <ConnectGithubDialog
          isBusy={isRepositoryBusy}
          onCancel={() => setRepositoryDialog(null)}
          onConnect={(token) => void connectGithub(token)}
        />
      ) : null}
      {repositoryDialog === "link" && repositoryAccount ? (
        <LinkGithubWorkspaceDialog
          account={repositoryAccount}
          isBusy={isRepositoryBusy}
          repositories={githubRepositories}
          workspaceRoot={workspaceRoot}
          onCancel={() => setRepositoryDialog(null)}
          onLink={(params) => void linkCurrentWorkspace(params)}
        />
      ) : null}
      {repositoryDialog === "status" && repositorySyncStatus ? (
        <RepositorySyncStatusDialog
          status={repositorySyncStatus}
          onClose={() => setRepositoryDialog(null)}
          onPull={() => void runRepositorySyncAction("pull")}
          onPush={() => void runRepositorySyncAction("push")}
          onSync={() => void runRepositorySyncAction("sync")}
        />
      ) : null}
    </>
  );
}

function findFirstFile(items: WorkspaceItem[]): WorkspaceItem | null {
  for (const item of items) {
    if (item.type === "file") {
      return item;
    }

    if (item.children) {
      const firstFile = findFirstFile(item.children);
      if (firstFile) {
        return firstFile;
      }
    }
  }

  return null;
}

function normalizeWorkspacePath(rawPath: string): string {
  return rawPath
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .map((pathPart) => pathPart.trim())
    .filter(Boolean)
    .join("/");
}

function normalizeMarkdownFileName(rawFileName: string): string {
  const relativePath = normalizeWorkspacePath(rawFileName);

  if (!relativePath) {
    return "";
  }

  return /\.(md|markdown)$/i.test(relativePath)
    ? relativePath
    : `${relativePath}.md`;
}

function joinWorkspacePath(
  parentPath: string | null,
  childPath: string,
): string {
  const normalizedParentPath = normalizeWorkspacePath(parentPath ?? "");
  const normalizedChildPath = normalizeWorkspacePath(childPath);

  if (!normalizedParentPath) {
    return normalizedChildPath;
  }

  if (!normalizedChildPath) {
    return normalizedParentPath;
  }

  return `${normalizedParentPath}/${normalizedChildPath}`;
}

function remapPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) {
    return newPath;
  }

  if (path.startsWith(`${oldPath}/`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }

  return path;
}

function remapDocumentPaths(
  documents: WorkspaceDocumentMap,
  oldPath: string,
  newPath: string,
): WorkspaceDocumentMap {
  return Object.fromEntries(
    Object.entries(documents).map(([path, content]) => [
      remapPath(path, oldPath, newPath),
      content,
    ]),
  );
}

function remapDirtyFileIds(
  dirtyFileIds: Set<string>,
  oldPath: string,
  newPath: string,
): Set<string> {
  return new Set(
    [...dirtyFileIds].map((dirtyFileId) =>
      remapPath(dirtyFileId, oldPath, newPath),
    ),
  );
}

function targetAffectsDirtyFile(
  targetPath: string,
  dirtyFileIds: Set<string>,
): boolean {
  return [...dirtyFileIds].some((dirtyFileId) => {
    return (
      dirtyFileId === targetPath || dirtyFileId.startsWith(`${targetPath}/`)
    );
  });
}

function isUntitledDocument(documentId: string): boolean {
  return documentId.startsWith("untitled:");
}

function deriveDefaultMarkdownFileName(
  markdownContent: string,
  fallbackTitle: string,
): string {
  const firstHeading = markdownContent
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
    .find(Boolean);
  const rawTitle = firstHeading || fallbackTitle || "Untitled";
  const safeTitle = rawTitle.replace(/[\\/:*?"<>|]/g, " ").trim() || "Untitled";

  return /\.(md|markdown)$/i.test(safeTitle) ? safeTitle : `${safeTitle}.md`;
}

function ensureMarkdownFilePath(filePath: string): string {
  return /\.(md|markdown)$/i.test(filePath) ? filePath : `${filePath}.md`;
}

function parentPathOf(filePath: string): string {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const pathParts = normalizedPath.split("/");
  pathParts.pop();

  return pathParts.join("/") || "/";
}

function fileNameOf(filePath: string): string {
  return filePath.replaceAll("\\", "/").split("/").at(-1) ?? "Untitled.md";
}

function codeFenceTemplate(language: string): string {
  if (language === "mermaid") {
    return "\n```mermaid\ngraph TD\n  A[Start] --> B[End]\n```\n";
  }

  if (language === "plantuml") {
    return "\n```plantuml\n@startuml\nAlice -> Bob: Hello\n@enduml\n```\n";
  }

  return `\n\`\`\`${language}\n\n\`\`\`\n`;
}

function timestampForFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}
