import { APP_ZOOM_CONFIG } from "./appZoomConfig";
import { readStoredDebugEnabled } from "../../shared/debug/debugSettings";
import { translateCurrent } from "../../shared/i18n/translate";
import { hasPrimaryModifier } from "../../shared/platform/keyboard";

export const NORMAL_APP_ZOOM = APP_ZOOM_CONFIG.normal;
export const MIN_COMMITTED_APP_ZOOM = APP_ZOOM_CONFIG.minimum;
export const MIN_INTERACTION_APP_ZOOM = APP_ZOOM_CONFIG.interactionMinimum;
export const MAX_APP_ZOOM = APP_ZOOM_CONFIG.maximum;
export const APP_ZOOM_STEP = APP_ZOOM_CONFIG.step;
export const ZOOM_SETTLE_DELAY_MS = APP_ZOOM_CONFIG.settleDelayMs;
export const ZOOM_SNAP_DURATION_MS = APP_ZOOM_CONFIG.snapDurationMs;
export const APP_ZOOM_SCROLL_LOCK_MS = APP_ZOOM_CONFIG.scrollLockMs;
export const WHEEL_ZOOM_DELTA_LIMIT = APP_ZOOM_CONFIG.wheelDeltaLimit;
export const WHEEL_ZOOM_SENSITIVITY = APP_ZOOM_CONFIG.wheelSensitivity;
export const NATIVE_PINCH_ZOOM_SENSITIVITY = APP_ZOOM_CONFIG.nativeDeltaSensitivity;
export const NATIVE_PINCH_SCALE_SENSITIVITY = APP_ZOOM_CONFIG.nativeScaleSensitivity;
export const NATIVE_GESTURE_WHEEL_SUPPRESS_MS = APP_ZOOM_CONFIG.wheelSuppressionAfterNativeGestureMs;
export const APP_CANVAS_ZOOM_ENABLED = APP_ZOOM_CONFIG.enabled;

export function clampInteractionZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return NORMAL_APP_ZOOM;
  }

  return Math.max(MIN_INTERACTION_APP_ZOOM, Math.min(MAX_APP_ZOOM, value));
}

export function clampCommittedZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return NORMAL_APP_ZOOM;
  }

  return Math.max(MIN_COMMITTED_APP_ZOOM, Math.min(MAX_APP_ZOOM, value));
}

export function isAppZoomWheelEvent(event: WheelEvent): boolean {
  return hasPrimaryModifier(event) && Math.abs(event.deltaY) > Math.abs(event.deltaX);
}

export function consumeAppZoomWheelEvent(event: WheelEvent): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

export function consumeAppZoomPointerEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function isAppZoomDebugOverlayEnabled(): boolean {
  return readStoredDebugEnabled();
}

function writeAppZoomDebugOverlay(note: string): void {
  if (!isAppZoomDebugOverlayEnabled()) {
    return;
  }

  const overlayId = "polarbear-app-zoom-debug-overlay";
  let overlay = document.getElementById(overlayId) as HTMLDivElement | null;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.dataset.polarbearDebugOverlay = "true";
    overlay.style.position = "fixed";
    overlay.style.right = "12px";
    overlay.style.bottom = "12px";
    overlay.style.zIndex = "2147483647";
    overlay.style.maxWidth = "760px";
    overlay.style.maxHeight = "38vh";
    overlay.style.margin = "0";
    overlay.style.padding = "10px 12px";
    overlay.style.overflow = "auto";
    overlay.style.border = "1px solid rgba(148, 163, 184, 0.45)";
    overlay.style.borderRadius = "8px";
    overlay.style.background = "rgba(15, 23, 42, 0.92)";
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
      const text = overlay?.querySelector("pre")?.textContent ?? "";
      void copyDebugText(text);
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
    pre.textContent = `APP ZOOM DEBUG\n${note}`;
  }
}

async function copyDebugText(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Debug copy is best-effort and must never take the app down.
  }
}

export function removePolarbearDebugOverlays(): void {
  document.getElementById("polarbear-app-zoom-debug-overlay")?.remove();
  document.getElementById("polarbear-live-debug-overlay")?.remove();
  document
    .querySelectorAll("[data-polarbear-debug-overlay='true'], .typora-live-debug-panel")
    .forEach((element) => element.remove());
}

export function dispatchAppZoomDebug(
  phase: string,
  params: {
    canvas?: HTMLElement | null;
    canvasSize?: HTMLElement | null;
    extra?: Record<string, boolean | number | string | null | undefined>;
    prepared?: boolean;
    viewport?: HTMLElement | null;
    zoom?: number;
  } = {},
): void {
  const viewport = params.viewport ?? null;
  const canvasSize = params.canvasSize ?? null;
  const canvas = params.canvas ?? null;
  const liveScroller = document.querySelector(".typora-live-editor-pane .cm-scroller");
  const liveScrollerElement = liveScroller instanceof HTMLElement ? liveScroller : null;
  const extraNote = params.extra
    ? Object.entries(params.extra)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}=${String(value)}`)
    : [];
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
    `liveScroll=${liveScrollerElement ? `${Math.round(liveScrollerElement.scrollLeft)},${Math.round(liveScrollerElement.scrollTop)}` : "n/a"}`,
    ...extraNote,
  ].join(" ");

  writeAppZoomDebugOverlay(note);
}

function setAppCanvasZoomDataset(zoom: number): void {
  document.documentElement.dataset.appCanvasZoom = Number.isFinite(zoom)
    ? zoom.toFixed(6)
    : "1.000000";
}

export function setAppCanvasZoomingDataset(isZooming: boolean): void {
  if (isZooming) {
    document.documentElement.dataset.appCanvasZooming = "true";
    return;
  }

  delete document.documentElement.dataset.appCanvasZooming;
}

export function syncAppCanvasZoomDataset(zoom: number, forceZooming = false): void {
  setAppCanvasZoomDataset(zoom);
  setAppCanvasZoomingDataset(forceZooming || zoom > NORMAL_APP_ZOOM + 0.0005);
}

export function shouldIgnoreAppZoomEvent(event: Event): boolean {
  if (document.querySelector(".image-viewer-overlay")) {
    return true;
  }

  const target = event.target;
  return target instanceof Element && Boolean(target.closest(
    ".image-viewer-overlay",
  ));
}

export function resolveScrollableElementFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const scroller =
    target.closest(".cm-scroller") ??
    target.closest(".markdown-preview") ??
    target.closest(".workspace-tree-shell");

  return scroller instanceof HTMLElement ? scroller : null;
}

export function shouldIgnoreAppZoomEditorPointerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  if (target.closest(".cm-content, .cm-line")) {
    return false;
  }

  return Boolean(target.closest(
    "button, input, select, textarea, [contenteditable='true'], .cm-typora-diagram-preview, .cm-typora-table-preview, .cm-typora-image-preview",
  ));
}

export type AppZoomPointerLikeEvent = Event & {
  button?: number;
  clientX: number;
  clientY: number;
  shiftKey?: boolean;
};

export function isAppZoomPointerLikeEvent(event: Event): event is AppZoomPointerLikeEvent {
  const pointer = event as Partial<AppZoomPointerLikeEvent>;
  return (
    typeof pointer.clientX === "number" &&
    Number.isFinite(pointer.clientX) &&
    typeof pointer.clientY === "number" &&
    Number.isFinite(pointer.clientY)
  );
}

export function shouldLetEditorHandleWheel(event: WheelEvent): boolean {
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

export type NativePinchEventLike = CustomEvent<{
  delta?: number;
  magnification?: number;
  phase?: number | string;
  scale?: number;
  state?: number | string;
  x?: number;
  y?: number;
}>;
export type NativePinchPayload = NativePinchEventLike["detail"];

export type AppCanvasSize = {
  width: number;
  height: number;
};

export type AppCanvasTransform = {
  scale: number;
  x: number;
  y: number;
};

export type AppCanvasPlacement = {
  canvasHeight: number;
  canvasWidth: number;
  offsetLeft: number;
  offsetTop: number;
};

export type ZoomAnchor = {
  pointerX: number;
  pointerY: number;
  canvasX: number;
  canvasY: number;
};

export type InnerScrollLock = {
  left: number;
  top: number;
};

export type AppZoomCursorPlacementDebug = {
  adjustedClientX: number;
  adjustedClientY: number;
  afterDispatchScrollLeft: number;
  afterDispatchScrollTop: number;
  beforeScrollLeft: number;
  beforeScrollTop: number;
  cursorPos: number;
  eventType: string;
  rawClientX: number;
  rawClientY: number;
  transformScale: number;
  transformX: number;
  transformY: number;
  viewportLeft: number | null;
  viewportTop: number | null;
  when: number;
};

export function readAppCanvasSize(): AppCanvasSize {
  return {
    width: Math.max(320, Math.floor(window.visualViewport?.width ?? window.innerWidth)),
    height: Math.max(320, Math.floor(window.visualViewport?.height ?? window.innerHeight)),
  };
}

export function measureAppCanvasSize(canvas: HTMLElement | null): AppCanvasSize {
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

export function isNativePinchEndPhase(phase: unknown): boolean {
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
