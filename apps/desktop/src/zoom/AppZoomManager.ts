import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const DEFAULT_APP_ZOOM = 1;
const MIN_APP_ZOOM = 0.5;
const MIN_COMMITTED_APP_ZOOM = 1;
const MIN_INTERACTION_APP_ZOOM = 0.82;
const MAX_APP_ZOOM = 3;
const APP_ZOOM_STEP = 0.1;
const WHEEL_ZOOM_SENSITIVITY = 0.002;
const WHEEL_ZOOM_DELTA_LIMIT = 80;
const APP_ZOOM_MAX_FRAME_STEP = 1.08;
const NATIVE_PINCH_ZOOM_SENSITIVITY = 2.35;
const APP_ZOOM_STORAGE_KEY = "polarbear.appZoom";
const APP_ZOOM_SETTLE_DELAY_MS = 180;
const NATIVE_GESTURE_WHEEL_SUPPRESS_MS = 160;

type NativePinchPayload = {
  delta?: number;
  magnification?: number;
  x?: number;
  y?: number;
};

type AppZoomAnchor = {
  anchorElement: Element | null;
  anchorRatioX: number;
  anchorRatioY: number;
  clientX: number;
  clientY: number;
  oldScrollLeft: number;
  oldScrollTop: number;
  oldZoom: number;
  pointerX: number;
  pointerY: number;
  scrollElement: HTMLElement;
};

function clampAppZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_APP_ZOOM;
  }

  return Math.min(MAX_APP_ZOOM, Math.max(MIN_APP_ZOOM, value));
}

function clampInteractionZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_APP_ZOOM;
  }

  return Math.min(MAX_APP_ZOOM, Math.max(MIN_INTERACTION_APP_ZOOM, value));
}

function clampCommittedZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_APP_ZOOM;
  }

  return Math.min(MAX_APP_ZOOM, Math.max(MIN_COMMITTED_APP_ZOOM, value));
}

function limitZoomStep(nextZoom: number, baseZoom: number): number {
  if (!Number.isFinite(nextZoom) || !Number.isFinite(baseZoom) || baseZoom <= 0) {
    return nextZoom;
  }

  const minStep = 1 / APP_ZOOM_MAX_FRAME_STEP;
  const step = Math.min(
    APP_ZOOM_MAX_FRAME_STEP,
    Math.max(minStep, nextZoom / baseZoom),
  );

  return baseZoom * step;
}

function readStoredAppZoom(): number | null {
  const storedZoom = window.localStorage.getItem(APP_ZOOM_STORAGE_KEY);
  if (!storedZoom) {
    return null;
  }

  const parsedZoom = Number(storedZoom);
  return Number.isFinite(parsedZoom) ? clampCommittedZoom(parsedZoom) : null;
}

function storeAppZoom(zoom: number): void {
  window.localStorage.setItem(APP_ZOOM_STORAGE_KEY, String(clampCommittedZoom(zoom)));
}

export class AppZoomManager {
  private disposed = false;
  private activeGestureAnchor: AppZoomAnchor | null = null;
  private eventUnlisten: UnlistenFn | null = null;
  private interactionZoom: number | null = null;
  private lastAnchor: AppZoomAnchor | null = null;
  private lastClientPoint: { x: number; y: number } | null = null;
  private lastNativePinchAt = 0;
  private nativePinchUnlisten: UnlistenFn | null = null;
  private pendingAnchor: AppZoomAnchor | null = null;
  private pendingZoom: number | null = null;
  private rafId: number | null = null;
  private settleTimer: number | null = null;
  private zoom = DEFAULT_APP_ZOOM;

  async init(): Promise<void> {
    try {
      this.zoom = clampAppZoom(await invoke<number>("get_app_zoom"));
    } catch {
      this.zoom = DEFAULT_APP_ZOOM;
    }

    const storedZoom = readStoredAppZoom();
    if (storedZoom !== null && Math.abs(storedZoom - this.zoom) > 0.0005) {
      await this.setZoom(storedZoom);
    } else {
      this.updateZoomMetadata(this.zoom);
    }

    void listen<number>("app-zoom-changed", (event) => {
      this.zoom = clampAppZoom(event.payload);
      if (this.zoom >= MIN_COMMITTED_APP_ZOOM) {
        storeAppZoom(this.zoom);
      }
      this.updateZoomMetadata(this.zoom);
    }).then((unlisten) => {
      if (this.disposed) {
        unlisten();
        return;
      }

      this.eventUnlisten = unlisten;
    });

    window.addEventListener("wheel", this.handleWheel, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointermove", this.handlePointerMove, {
      capture: true,
      passive: true,
    });

    void listen<NativePinchPayload>("polarbear-native-pinch", (event) => {
      this.applyNativePinch(event.payload);
    }).then((unlisten) => {
      if (this.disposed) {
        unlisten();
        return;
      }

      this.nativePinchUnlisten = unlisten;
    });
  }

  dispose(): void {
    this.disposed = true;
    this.eventUnlisten?.();
    this.eventUnlisten = null;
    this.nativePinchUnlisten?.();
    this.nativePinchUnlisten = null;
    window.removeEventListener("wheel", this.handleWheel, { capture: true });
    window.removeEventListener("pointermove", this.handlePointerMove, { capture: true });

    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.settleTimer !== null) {
      window.clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }

    this.activeGestureAnchor = null;
    this.interactionZoom = null;
    this.pendingAnchor = null;
    this.pendingZoom = null;
  }

  getZoom(): number {
    return this.zoom;
  }

  async resetZoom(): Promise<number> {
    return this.setZoomAtLastPoint(DEFAULT_APP_ZOOM, true);
  }

  async zoomIn(): Promise<number> {
    return this.setZoomAtLastPoint(this.zoom + APP_ZOOM_STEP, true);
  }

  async zoomOut(): Promise<number> {
    return this.setZoomAtLastPoint(this.zoom - APP_ZOOM_STEP, true);
  }

  async setZoom(zoom: number): Promise<number> {
    const anchor = this.captureAnchorAtLastPoint();
    return this.setZoomAtAnchor(zoom, anchor, true);
  }

  private async setZoomAtLastPoint(zoom: number, committed: boolean): Promise<number> {
    const anchor = this.captureAnchorAtLastPoint();
    return this.setZoomAtAnchor(zoom, anchor, committed);
  }

  private async setZoomAtAnchor(
    zoom: number,
    anchor: AppZoomAnchor,
    committed: boolean,
  ): Promise<number> {
    const requestedZoom = committed
      ? clampCommittedZoom(zoom)
      : clampInteractionZoom(zoom);
    const nextZoom = await invoke<number>("set_app_zoom", {
      zoom: requestedZoom,
    });
    const acceptedZoom = this.acceptZoom(nextZoom, committed);
    this.restoreAnchor(anchor, acceptedZoom);
    return acceptedZoom;
  }

  private acceptZoom(zoom: number, committed: boolean): number {
    this.zoom = clampAppZoom(zoom);
    if (committed && this.zoom >= MIN_COMMITTED_APP_ZOOM) {
      storeAppZoom(this.zoom);
    }
    this.updateZoomMetadata(this.zoom);
    return this.zoom;
  }

  private applyNativePinch(payload: NativePinchPayload): void {
    if (document.querySelector(".image-viewer-overlay, .mermaid-zoom-overlay")) {
      return;
    }

    const delta =
      typeof payload.delta === "number" && Number.isFinite(payload.delta)
        ? payload.delta
        : typeof payload.magnification === "number" && Number.isFinite(payload.magnification)
          ? payload.magnification
          : 0;

    if (Math.abs(delta) < 0.000001) {
      return;
    }

    this.lastNativePinchAt = Date.now();
    const point = this.resolveClientPoint(payload.x, payload.y);
    const baseZoom = this.pendingZoom ?? this.interactionZoom ?? this.zoom;
    this.scheduleSetZoom(
      baseZoom * Math.exp(delta * NATIVE_PINCH_ZOOM_SENSITIVITY),
      point.x,
      point.y,
    );
  }

  private handleWheel = (event: WheelEvent): void => {
    if (!event.metaKey && !event.ctrlKey) {
      return;
    }

    if (Date.now() - this.lastNativePinchAt < NATIVE_GESTURE_WHEEL_SUPPRESS_MS) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(".image-viewer-overlay, .mermaid-zoom-overlay")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.lastClientPoint = { x: event.clientX, y: event.clientY };
    const baseZoom = this.pendingZoom ?? this.interactionZoom ?? this.zoom;
    const safeDeltaY = Math.max(
      -WHEEL_ZOOM_DELTA_LIMIT,
      Math.min(WHEEL_ZOOM_DELTA_LIMIT, event.deltaY),
    );
    this.scheduleSetZoom(
      baseZoom * Math.exp(-safeDeltaY * WHEEL_ZOOM_SENSITIVITY),
      event.clientX,
      event.clientY,
    );
  };

  private handlePointerMove = (event: PointerEvent): void => {
    this.lastClientPoint = { x: event.clientX, y: event.clientY };
  };

  private scheduleSetZoom(nextZoom: number, clientX: number, clientY: number): void {
    const baseZoom = this.pendingZoom ?? this.interactionZoom ?? this.zoom;
    this.pendingZoom = clampInteractionZoom(limitZoomStep(nextZoom, baseZoom));
    this.interactionZoom = this.pendingZoom;
    if (!this.activeGestureAnchor) {
      this.activeGestureAnchor = this.captureAnchor(clientX, clientY);
    }
    this.pendingAnchor = this.activeGestureAnchor;
    this.lastAnchor = this.pendingAnchor;
    this.updateZoomMetadata(this.pendingZoom);
    this.scheduleSettle();

    if (this.rafId !== null) {
      return;
    }

    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;

      const targetZoom = this.pendingZoom;
      const targetAnchor = this.pendingAnchor;
      this.pendingZoom = null;
      this.pendingAnchor = null;
      if (targetZoom === null || this.disposed) {
        return;
      }

      void this.setZoomAtAnchor(
        targetZoom,
        targetAnchor ?? this.captureAnchorAtLastPoint(),
        false,
      );
    });
  }

  private scheduleSettle(): void {
    if (this.settleTimer !== null) {
      window.clearTimeout(this.settleTimer);
    }

    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      void this.settleInteractionZoom();
    }, APP_ZOOM_SETTLE_DELAY_MS);
  }

  private async settleInteractionZoom(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const interactionZoom = this.interactionZoom ?? this.zoom;

    if (interactionZoom < MIN_COMMITTED_APP_ZOOM) {
      await this.setZoomAtAnchor(
        DEFAULT_APP_ZOOM,
        this.lastAnchor ?? this.captureAnchorAtLastPoint(),
        true,
      );
      this.activeGestureAnchor = null;
      this.interactionZoom = null;
      this.pendingAnchor = null;
      this.pendingZoom = null;
      return;
    }

    if (Math.abs(interactionZoom - this.zoom) > 0.0005) {
      await this.setZoomAtAnchor(
        interactionZoom,
        this.lastAnchor ?? this.captureAnchorAtLastPoint(),
        true,
      );
    } else {
      this.acceptZoom(this.zoom, true);
    }
    this.activeGestureAnchor = null;
    this.interactionZoom = null;
    this.pendingAnchor = null;
    this.pendingZoom = null;
  }

  private captureAnchorAtLastPoint(): AppZoomAnchor {
    const point = this.resolveClientPoint(
      this.lastClientPoint?.x,
      this.lastClientPoint?.y,
    );
    return this.captureAnchor(point.x, point.y);
  }

  private captureAnchor(clientX: number, clientY: number): AppZoomAnchor {
    const elementAtPoint = document.elementFromPoint(clientX, clientY);
    const scrollElement = findScrollableElement(elementAtPoint);
    const scrollRect = scrollElement.getBoundingClientRect();
    const pointerX = clientX - scrollRect.left;
    const pointerY = clientY - scrollRect.top;
    const anchorElement = elementAtPoint instanceof Element
      ? elementAtPoint
      : scrollElement;
    const anchorRect = anchorElement.getBoundingClientRect();
    const anchorRatioX = anchorRect.width > 0
      ? (clientX - anchorRect.left) / anchorRect.width
      : 0;
    const anchorRatioY = anchorRect.height > 0
      ? (clientY - anchorRect.top) / anchorRect.height
      : 0;

    return {
      anchorElement,
      anchorRatioX,
      anchorRatioY,
      clientX,
      clientY,
      oldScrollLeft: scrollElement.scrollLeft,
      oldScrollTop: scrollElement.scrollTop,
      oldZoom: this.zoom,
      pointerX,
      pointerY,
      scrollElement,
    };
  }

  private restoreAnchor(anchor: AppZoomAnchor, nextZoom: number): void {
    window.requestAnimationFrame(() => {
      this.restoreAnchorNow(anchor, nextZoom);
      window.requestAnimationFrame(() => this.restoreAnchorNow(anchor, nextZoom));
    });
  }

  private restoreAnchorNow(anchor: AppZoomAnchor, nextZoom: number): void {
    const scrollElement = anchor.scrollElement;
    if (!scrollElement.isConnected) {
      return;
    }

    const oldZoom = anchor.oldZoom > 0 ? anchor.oldZoom : DEFAULT_APP_ZOOM;
    const safeNextZoom = nextZoom > 0 ? nextZoom : DEFAULT_APP_ZOOM;

    const documentX = (anchor.oldScrollLeft + anchor.pointerX) / oldZoom;
    const documentY = (anchor.oldScrollTop + anchor.pointerY) / oldZoom;
    const currentRect = scrollElement.getBoundingClientRect();
    const pointerX = anchor.clientX - currentRect.left;
    const pointerY = anchor.clientY - currentRect.top;

    scrollElement.scrollLeft = documentX * safeNextZoom - pointerX;
    scrollElement.scrollTop = documentY * safeNextZoom - pointerY;
  }

  private resolveClientPoint(x?: number, y?: number): { x: number; y: number } {
    if (
      typeof x === "number" &&
      Number.isFinite(x) &&
      typeof y === "number" &&
      Number.isFinite(y)
    ) {
      this.lastClientPoint = { x, y };
      return { x, y };
    }

    if (this.lastClientPoint) {
      return this.lastClientPoint;
    }

    return {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    };
  }

  private updateZoomMetadata(zoom: number): void {
    const percent = `${Math.round(zoom * 100)}%`;
    document.documentElement.dataset.appZoom = String(zoom);
    document.documentElement.dataset.appZoomPercent = percent;
    window.dispatchEvent(
      new CustomEvent("polarbear-app-zoom-changed", {
        detail: {
          percent,
          zoom,
        },
      }),
    );
  }
}

function findScrollableElement(startElement: Element | null): HTMLElement {
  let current: Element | null = startElement;

  while (current) {
    if (current instanceof HTMLElement && isScrollable(current)) {
      return current;
    }

    current = current.parentElement;
  }

  const scrollingElement = document.scrollingElement;
  if (scrollingElement instanceof HTMLElement) {
    return scrollingElement;
  }

  return document.documentElement;
}

function isScrollable(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const canScrollY =
    element.scrollHeight > element.clientHeight + 1 &&
    /auto|scroll|overlay/.test(style.overflowY);
  const canScrollX =
    element.scrollWidth > element.clientWidth + 1 &&
    /auto|scroll|overlay/.test(style.overflowX);

  return canScrollY || canScrollX;
}
