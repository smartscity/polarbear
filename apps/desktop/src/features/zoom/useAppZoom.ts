import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { EditorView } from "@codemirror/view";
import { type MarkdownEditorView } from "../../features/editor/components/MarkdownEditor";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { APP_CANVAS_ZOOM_ENABLED, APP_ZOOM_SCROLL_LOCK_MS, APP_ZOOM_STEP, MIN_COMMITTED_APP_ZOOM, NATIVE_GESTURE_WHEEL_SUPPRESS_MS, NATIVE_PINCH_SCALE_SENSITIVITY, NATIVE_PINCH_ZOOM_SENSITIVITY, NORMAL_APP_ZOOM, WHEEL_ZOOM_DELTA_LIMIT, WHEEL_ZOOM_SENSITIVITY, ZOOM_SETTLE_DELAY_MS, ZOOM_SNAP_DURATION_MS, clampCommittedZoom, clampInteractionZoom, consumeAppZoomPointerEvent, consumeAppZoomWheelEvent, dispatchAppZoomDebug, isAppZoomPointerLikeEvent, isAppZoomWheelEvent, isNativePinchEndPhase, readAppCanvasSize, resolveScrollableElementFromTarget, setAppCanvasZoomingDataset, shouldIgnoreAppZoomEditorPointerTarget, shouldIgnoreAppZoomEvent, shouldLetEditorHandleWheel, syncAppCanvasZoomDataset, type AppCanvasPlacement, type AppCanvasSize, type AppCanvasTransform, type AppZoomCursorPlacementDebug, type AppZoomPointerLikeEvent, type InnerScrollLock, type NativePinchPayload, type ZoomAnchor } from "../../features/zoom/appZoomRuntime";
import { setNativeAppZoom, subscribeNativePinch } from "./tauriZoomAdapter";
import { STORAGE_KEYS } from "../../shared/constants/storageKeys";
import { APP_EVENTS } from "../../shared/events/appEvents";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { resolveEditorPositionAtVisualPointer } from "./editorPointerPosition";
import { useEventCallback } from "../../shared/hooks/useEventCallback";

type AppZoomOptions = {
  editorViewRef: RefObject<MarkdownEditorView | null>;
  onStatus: Dispatch<SetStateAction<string>>;
};

/** Owns gesture scheduling, canvas bounds and their window-scoped resources. */
export function useAppZoom({ editorViewRef, onStatus: setStatusMessage }: AppZoomOptions) {
  const { t } = useI18n();
  const reportZoomError = useEventCallback(() => setStatusMessage(t("status.zoomUnavailable")));
  const zoomViewportRef = useRef<HTMLDivElement | null>(null);
  const zoomCanvasSizeRef = useRef<HTMLDivElement | null>(null);
  const zoomCanvasRef = useRef<HTMLDivElement | null>(null);
  const appZoomRef = useRef(1);
  const appCanvasSizeRef = useRef<AppCanvasSize>(readAppCanvasSize());
  const appCanvasTransformRef = useRef<AppCanvasTransform>({
    scale: NORMAL_APP_ZOOM,
    x: 0,
    y: 0,
  });
  const appCanvasPlacementRef = useRef<AppCanvasPlacement | null>(null);
  const appZoomInteractionSurfacePreparedRef = useRef(false);
  const zoomRafRef = useRef(0);
  const pendingZoomRef = useRef(1);
  const pendingAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const activeZoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const lastNativeGestureAtRef = useRef(0);
  const lastZoomClientRef = useRef<{ x: number; y: number } | null>(null);

  const zoomScrollUnlockTimerRef = useRef<number | null>(null);
  const zoomScrollLockUntilRef = useRef(0);
  const zoomInnerScrollLocksRef = useRef<Map<HTMLElement, InnerScrollLock>>(new Map());
  const lastInnerScrollRestoreDebugAtRef = useRef(0);
  const lastAppZoomCursorPlacementAtRef = useRef(0);
  const lastAppZoomCursorPlacementDebugRef = useRef<AppZoomCursorPlacementDebug | null>(null);
  const zoomSettleTimerRef = useRef<number | null>(null);
  const zoomSnapAnimationRef = useRef(0);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);

  const [appCanvasSize, setAppCanvasSize] = useState<AppCanvasSize>(() =>
    appCanvasSizeRef.current,
  );
  const [canvasViewportSyncRevision, setCanvasViewportSyncRevision] = useState(0);

  const requestCanvasViewportSync = useCallback(() => {
    setCanvasViewportSyncRevision((revision) => revision + 1);
  }, []);


  const commitZoom = useCallback((nextZoom: number) => {
    const zoom = clampCommittedZoom(nextZoom);
    appZoomRef.current = zoom;
    syncAppCanvasZoomDataset(zoom);
  }, []);

  const clampCanvasTranslate = useCallback((
    scale: number,
    x: number,
    y: number,
  ): { x: number; y: number } => {
    const viewport = zoomViewportRef.current;
    const size = appCanvasSizeRef.current;
    const viewportWidth = viewport?.clientWidth ?? size.width;
    const viewportHeight = viewport?.clientHeight ?? size.height;
    const scaledWidth = size.width * scale;
    const scaledHeight = size.height * scale;

    const clampAxis = (value: number, viewportSize: number, scaledSize: number) => {
      if (scaledSize <= viewportSize) {
        return Math.max(0, Math.min(viewportSize - scaledSize, value));
      }

      return Math.min(0, Math.max(viewportSize - scaledSize, value));
    };

    return {
      x: clampAxis(x, viewportWidth, scaledWidth),
      y: clampAxis(y, viewportHeight, scaledHeight),
    };
  }, []);

  const applyCanvasTransform = useCallback((
    nextTransform: AppCanvasTransform,
    allowElasticZoom = true,
  ) => {
    const scale = allowElasticZoom
      ? clampInteractionZoom(nextTransform.scale)
      : clampCommittedZoom(nextTransform.scale);
    const resetToNormal = !allowElasticZoom && scale <= NORMAL_APP_ZOOM + 0.0005;
    const nextTranslate = resetToNormal
      ? { x: 0, y: 0 }
      : clampCanvasTranslate(scale, nextTransform.x, nextTransform.y);
    const size = appCanvasSizeRef.current;

    appZoomRef.current = scale;
    appCanvasTransformRef.current = {
      scale,
      x: nextTranslate.x,
      y: nextTranslate.y,
    };
    syncAppCanvasZoomDataset(scale, allowElasticZoom);

    if (!allowElasticZoom) {
      appZoomInteractionSurfacePreparedRef.current = false;
    }

    if (zoomCanvasSizeRef.current) {
      zoomCanvasSizeRef.current.style.width = "100%";
      zoomCanvasSizeRef.current.style.height = "100%";
    }

    appCanvasPlacementRef.current = {
      canvasHeight: size.height,
      canvasWidth: size.width,
      offsetLeft: 0,
      offsetTop: 0,
    };

    if (zoomViewportRef.current) {
      zoomViewportRef.current.scrollLeft = 0;
      zoomViewportRef.current.scrollTop = 0;
    }

    if (zoomCanvasRef.current) {
      zoomCanvasRef.current.style.left = "0px";
      zoomCanvasRef.current.style.top = "0px";
      zoomCanvasRef.current.style.width = `${size.width}px`;
      zoomCanvasRef.current.style.height = `${size.height}px`;
      zoomCanvasRef.current.style.transformOrigin = "top left";
      zoomCanvasRef.current.style.transform = resetToNormal
        ? "none"
        : `translate3d(${nextTranslate.x}px, ${nextTranslate.y}px, 0) scale(${scale})`;
    }
  }, [clampCanvasTranslate]);

  const applyCanvasZoom = useCallback((nextZoom: number, allowElasticZoom = true) => {
    applyCanvasTransform({
      ...appCanvasTransformRef.current,
      scale: nextZoom,
    }, allowElasticZoom);
  }, [applyCanvasTransform]);

  const prepareAppZoomInteractionSurface = useCallback(() => {
    if (appZoomInteractionSurfacePreparedRef.current) {
      return;
    }

    appZoomInteractionSurfacePreparedRef.current = true;
    const size = appCanvasSizeRef.current;

    if (zoomCanvasSizeRef.current) {
      zoomCanvasSizeRef.current.style.width = "100%";
      zoomCanvasSizeRef.current.style.height = "100%";
    }
    appCanvasPlacementRef.current = {
      canvasHeight: size.height,
      canvasWidth: size.width,
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
    const transform = appCanvasTransformRef.current;

    return {
      pointerX,
      pointerY,
      canvasX: (pointerX - transform.x) / safeZoom,
      canvasY: (pointerY - transform.y) / safeZoom,
    };
  }, []);

  const applyVisualZoomAtAnchor = useCallback((nextZoom: number, anchor: ZoomAnchor) => {
    const zoom = clampInteractionZoom(nextZoom);
    prepareAppZoomInteractionSurface();
    applyCanvasTransform({
      scale: zoom,
      x: anchor.pointerX - anchor.canvasX * zoom,
      y: anchor.pointerY - anchor.canvasY * zoom,
    });
  }, [applyCanvasTransform, prepareAppZoomInteractionSurface]);

  const applyZoomAtAnchor = useCallback((
    nextZoom: number,
    anchor: ZoomAnchor,
    allowElasticZoom = true,
  ) => {
    const zoom = allowElasticZoom
      ? clampInteractionZoom(nextZoom)
      : clampCommittedZoom(nextZoom);
    applyCanvasTransform({
      scale: zoom,
      x: anchor.pointerX - anchor.canvasX * zoom,
      y: anchor.pointerY - anchor.canvasY * zoom,
    }, allowElasticZoom);
  }, [applyCanvasTransform]);

  const syncCanvasViewportBounds = useCallback(() => {
    if (activeZoomAnchorRef.current || zoomRafRef.current || zoomSnapAnimationRef.current) {
      return;
    }

    // The canvas is a window-sized surface. Internal document overflow belongs
    // to its own scroll container and must never increase the canvas baseline.
    const nextSize = readAppCanvasSize();

    appCanvasSizeRef.current = nextSize;
    setAppCanvasSize((currentSize) =>
      currentSize.width === nextSize.width && currentSize.height === nextSize.height
        ? currentSize
        : nextSize,
    );
    applyCanvasTransform(appCanvasTransformRef.current, false);
  }, [applyCanvasTransform]);

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

  const getInnerScrollLockElements = useCallback((): HTMLElement[] => {
    const root = zoomCanvasRef.current;
    if (!root) {
      return [];
    }

    const elements = root.querySelectorAll(
      ".cm-scroller, .markdown-preview, .workspace-tree-shell",
    );
    return Array.from(elements).filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
  }, []);

  const captureInnerScrollLocks = useCallback(() => {
    const locks = zoomInnerScrollLocksRef.current;
    for (const element of Array.from(locks.keys())) {
      if (!element.isConnected) {
        locks.delete(element);
      }
    }

    for (const element of getInnerScrollLockElements()) {
      if (!locks.has(element)) {
        locks.set(element, {
          left: element.scrollLeft,
          top: element.scrollTop,
        });
      }
    }
  }, [getInnerScrollLockElements]);

  const restoreInnerScrollLocks = useCallback(() => {
    const locks = zoomInnerScrollLocksRef.current;
    let restoredCount = 0;
    let liveBefore = "";
    let liveAfter = "";
    for (const [element, position] of Array.from(locks.entries())) {
      if (!element.isConnected) {
        locks.delete(element);
        continue;
      }

      const isLiveScroller = element.matches(".typora-live-editor-pane .cm-scroller");
      if (isLiveScroller) {
        liveBefore = `${Math.round(element.scrollLeft)},${Math.round(element.scrollTop)}`;
      }

      if (Math.abs(element.scrollLeft - position.left) > 0.5) {
        element.scrollLeft = position.left;
        restoredCount += 1;
      }

      if (Math.abs(element.scrollTop - position.top) > 0.5) {
        element.scrollTop = position.top;
        restoredCount += 1;
      }

      if (isLiveScroller) {
        liveAfter = `${Math.round(element.scrollLeft)},${Math.round(element.scrollTop)}`;
      }
    }

    const now = Date.now();
    if (
      restoredCount > 0 &&
      now - lastInnerScrollRestoreDebugAtRef.current > 120
    ) {
      lastInnerScrollRestoreDebugAtRef.current = now;
      dispatchAppZoomDebug("inner-scroll-restore", {
        canvas: zoomCanvasRef.current,
        canvasSize: zoomCanvasSizeRef.current,
        extra: {
          innerLocks: locks.size,
          lastCursorAgeMs: lastAppZoomCursorPlacementDebugRef.current
            ? Math.round(now - lastAppZoomCursorPlacementDebugRef.current.when)
            : "n/a",
          lastCursorEvent: lastAppZoomCursorPlacementDebugRef.current?.eventType ?? "n/a",
          lastCursorPos: lastAppZoomCursorPlacementDebugRef.current?.cursorPos ?? "n/a",
          lastCursorRaw: lastAppZoomCursorPlacementDebugRef.current
            ? `${Math.round(lastAppZoomCursorPlacementDebugRef.current.rawClientX)},${Math.round(lastAppZoomCursorPlacementDebugRef.current.rawClientY)}`
            : "n/a",
          lastCursorAdjusted: lastAppZoomCursorPlacementDebugRef.current
            ? `${Math.round(lastAppZoomCursorPlacementDebugRef.current.adjustedClientX)},${Math.round(lastAppZoomCursorPlacementDebugRef.current.adjustedClientY)}`
            : "n/a",
          lastCursorScrollBefore: lastAppZoomCursorPlacementDebugRef.current
            ? `${Math.round(lastAppZoomCursorPlacementDebugRef.current.beforeScrollLeft)},${Math.round(lastAppZoomCursorPlacementDebugRef.current.beforeScrollTop)}`
            : "n/a",
          lastCursorScrollAfterDispatch: lastAppZoomCursorPlacementDebugRef.current
            ? `${Math.round(lastAppZoomCursorPlacementDebugRef.current.afterDispatchScrollLeft)},${Math.round(lastAppZoomCursorPlacementDebugRef.current.afterDispatchScrollTop)}`
            : "n/a",
          liveAfter,
          liveBefore,
          restoredCount,
          transformScale: appCanvasTransformRef.current.scale.toFixed(4),
        },
        prepared: appZoomInteractionSurfacePreparedRef.current,
        viewport: zoomViewportRef.current,
        zoom: appZoomRef.current,
      });
    }
  }, []);

  const releaseInnerScrollLocks = useCallback(() => {
    zoomInnerScrollLocksRef.current.clear();
  }, []);

  const controlledInnerScroll = useCallback((
    target: EventTarget | null,
    deltaX: number,
    deltaY: number,
  ): boolean => {
    const element = resolveScrollableElementFromTarget(target);
    if (!element) {
      return false;
    }

    const beforeLeft = element.scrollLeft;
    const beforeTop = element.scrollTop;
    element.scrollLeft += deltaX;
    element.scrollTop += deltaY;

    const moved =
      Math.abs(element.scrollLeft - beforeLeft) > 0.5 ||
      Math.abs(element.scrollTop - beforeTop) > 0.5;

    if (moved) {
      zoomInnerScrollLocksRef.current.set(element, {
        left: element.scrollLeft,
        top: element.scrollTop,
      });
    }

    return moved;
  }, []);

  const placeEditorCursorDuringAppZoom = useCallback((event: AppZoomPointerLikeEvent): boolean => {
    const button = typeof event.button === "number" ? event.button : 0;
    if (button !== 0 || shouldIgnoreAppZoomEditorPointerTarget(event.target)) {
      return false;
    }

    const target = event.target;
    if (!(target instanceof Node) || !zoomCanvasRef.current?.contains(target)) {
      return false;
    }

    const editorView = editorViewRef.current as unknown as EditorView | null;
    if (!editorView?.dom.contains(target)) {
      return false;
    }

    const scrollDOM = editorView.scrollDOM;
    const scrollTop = scrollDOM.scrollTop;
    const scrollLeft = scrollDOM.scrollLeft;
    const transform = appCanvasTransformRef.current;
    const pos = resolveEditorPositionAtVisualPointer(
      editorView,
      event.clientX,
      event.clientY,
      transform.scale,
    );

    if (pos === null) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const currentSelection = editorView.state.selection.main;
    editorView.dispatch({
      selection: event.shiftKey
        ? {
            anchor: currentSelection.from,
            head: pos,
          }
        : {
            anchor: pos,
          },
      scrollIntoView: false,
    });
    lastAppZoomCursorPlacementAtRef.current = Date.now();
    const afterDispatchScrollTop = scrollDOM.scrollTop;
    const afterDispatchScrollLeft = scrollDOM.scrollLeft;
    lastAppZoomCursorPlacementDebugRef.current = {
      adjustedClientX: event.clientX,
      adjustedClientY: event.clientY,
      afterDispatchScrollLeft,
      afterDispatchScrollTop,
      beforeScrollLeft: scrollLeft,
      beforeScrollTop: scrollTop,
      cursorPos: pos,
      eventType: event.type,
      rawClientX: event.clientX,
      rawClientY: event.clientY,
      transformScale: transform.scale,
      transformX: transform.x,
      transformY: transform.y,
      viewportLeft: null,
      viewportTop: null,
      when: lastAppZoomCursorPlacementAtRef.current,
    };

    const restoreScroll = () => {
      scrollDOM.scrollTop = scrollTop;
      scrollDOM.scrollLeft = scrollLeft;
      zoomInnerScrollLocksRef.current.set(scrollDOM, {
        left: scrollLeft,
        top: scrollTop,
      });
    };
    editorView.contentDOM.focus({ preventScroll: true });
    if (scrollDOM.scrollTop !== scrollTop || scrollDOM.scrollLeft !== scrollLeft) {
      restoreScroll();
    }
    dispatchAppZoomDebug("cursor-place", {
      canvas: zoomCanvasRef.current,
      canvasSize: zoomCanvasSizeRef.current,
      extra: {
        afterDispatchScrollLeft: Math.round(afterDispatchScrollLeft),
        afterDispatchScrollTop: Math.round(afterDispatchScrollTop),
        beforeScrollLeft: Math.round(scrollLeft),
        beforeScrollTop: Math.round(scrollTop),
        cursorPos: pos,
        rawClientX: Math.round(event.clientX),
        rawClientY: Math.round(event.clientY),
        adjustedClientX: Math.round(event.clientX),
        adjustedClientY: Math.round(event.clientY),
        transformScale: transform.scale.toFixed(4),
        transformX: Math.round(transform.x),
        transformY: Math.round(transform.y),
        viewportLeft: "n/a",
        viewportTop: "n/a",
      },
      prepared: appZoomInteractionSurfacePreparedRef.current,
      viewport: zoomViewportRef.current,
      zoom: appZoomRef.current,
    });

    return true;
  }, [editorViewRef]);

  const lockAppZoomScroll = useCallback(() => {
    zoomScrollLockUntilRef.current = Math.max(
      zoomScrollLockUntilRef.current,
      Date.now() + APP_ZOOM_SCROLL_LOCK_MS,
    );
    document.documentElement.dataset.appCanvasZooming = "true";
    captureInnerScrollLocks();
    restoreInnerScrollLocks();

    if (zoomScrollUnlockTimerRef.current !== null) {
      window.clearTimeout(zoomScrollUnlockTimerRef.current);
    }

    zoomScrollUnlockTimerRef.current = window.setTimeout(() => {
      if (Date.now() < zoomScrollLockUntilRef.current) {
        return;
      }

      zoomScrollUnlockTimerRef.current = null;
      const isAtNormalZoom = appZoomRef.current <= NORMAL_APP_ZOOM + 0.0005;
      if (isAtNormalZoom) {
        applyCanvasZoom(NORMAL_APP_ZOOM, false);
        restoreInnerScrollLocks();
        releaseInnerScrollLocks();
      } else {
        setAppCanvasZoomingDataset(true);
        restoreInnerScrollLocks();
      }
      dispatchAppZoomDebug("unlock", {
        canvas: zoomCanvasRef.current,
        canvasSize: zoomCanvasSizeRef.current,
        extra: {
          appCanvasZooming: document.documentElement.dataset.appCanvasZooming ?? "false",
          innerLocks: zoomInnerScrollLocksRef.current.size,
          transformScale: appCanvasTransformRef.current.scale.toFixed(4),
          transformX: Math.round(appCanvasTransformRef.current.x),
          transformY: Math.round(appCanvasTransformRef.current.y),
        },
        prepared: appZoomInteractionSurfacePreparedRef.current,
        viewport: zoomViewportRef.current,
        zoom: appZoomRef.current,
      });
      if (isAtNormalZoom) {
        setAppCanvasZoomingDataset(false);
        window.dispatchEvent(new CustomEvent(APP_EVENTS.appCanvasZoomSettled));
      } else {
        setAppCanvasZoomingDataset(true);
      }
    }, APP_ZOOM_SCROLL_LOCK_MS + 40);
  }, [
    applyCanvasZoom,
    captureInnerScrollLocks,
    releaseInnerScrollLocks,
    restoreInnerScrollLocks,
  ]);

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

    let flushedPendingFrame = false;
    if (zoomRafRef.current) {
      window.cancelAnimationFrame(zoomRafRef.current);
      zoomRafRef.current = 0;
      flushedPendingFrame = true;
      if (activeZoomAnchorRef.current) {
        applyVisualZoomAtAnchor(pendingZoomRef.current, activeZoomAnchorRef.current);
      } else if (pendingAnchorRef.current) {
        zoomAtPoint(
          pendingZoomRef.current,
          pendingAnchorRef.current.x,
          pendingAnchorRef.current.y,
        );
      }
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
        extra: {
          flushedPendingFrame,
          innerLocks: zoomInnerScrollLocksRef.current.size,
          pendingZoom: pendingZoomRef.current.toFixed(4),
          transformScale: appCanvasTransformRef.current.scale.toFixed(4),
          transformX: Math.round(appCanvasTransformRef.current.x),
          transformY: Math.round(appCanvasTransformRef.current.y),
        },
        prepared: appZoomInteractionSurfacePreparedRef.current,
        viewport,
        zoom: currentZoom,
      });
      animateZoomTo(NORMAL_APP_ZOOM, anchor);
      activeZoomAnchorRef.current = null;
      return;
    }

    dispatchAppZoomDebug("settle-before", {
      canvas: zoomCanvasRef.current,
      canvasSize: zoomCanvasSizeRef.current,
      extra: {
        flushedPendingFrame,
        innerLocks: zoomInnerScrollLocksRef.current.size,
        keepTransform: true,
        pendingZoom: pendingZoomRef.current.toFixed(4),
        transformScale: appCanvasTransformRef.current.scale.toFixed(4),
        transformX: Math.round(appCanvasTransformRef.current.x),
        transformY: Math.round(appCanvasTransformRef.current.y),
      },
      prepared: appZoomInteractionSurfacePreparedRef.current,
      viewport,
      zoom: currentZoom,
    });
    // Keep the exact transform produced by the last gesture frame. Re-applying
    // it around an anchor at gesture end creates a visible snap when the final
    // wheel/native-pinch frame and the settle timer are not perfectly aligned.
    appZoomInteractionSurfacePreparedRef.current = false;
    if (currentZoom <= NORMAL_APP_ZOOM + 0.0005) {
      applyCanvasZoom(NORMAL_APP_ZOOM, false);
    }
    commitZoom(currentZoom);
    dispatchAppZoomDebug("settle-after", {
      canvas: zoomCanvasRef.current,
      canvasSize: zoomCanvasSizeRef.current,
      extra: {
        innerLocks: zoomInnerScrollLocksRef.current.size,
        keepTransform: true,
        transformScale: appCanvasTransformRef.current.scale.toFixed(4),
        transformX: Math.round(appCanvasTransformRef.current.x),
        transformY: Math.round(appCanvasTransformRef.current.y),
      },
      prepared: appZoomInteractionSurfacePreparedRef.current,
      viewport,
      zoom: currentZoom,
    });
    activeZoomAnchorRef.current = null;
  }, [
    applyCanvasZoom,
    animateZoomTo,
    applyVisualZoomAtAnchor,
    commitZoom,
    getAnchorCanvasPoint,
    lockAppZoomScroll,
    zoomAtPoint,
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

  const panZoomViewport = useCallback((deltaX: number, deltaY: number): boolean => {
    const current = appCanvasTransformRef.current;
    if (current.scale <= NORMAL_APP_ZOOM + 0.0005) {
      return false;
    }

    const nextX = current.x - deltaX;
    const nextY = current.y - deltaY;
    const clamped = clampCanvasTranslate(current.scale, nextX, nextY);
    const moved =
      Math.abs(clamped.x - current.x) > 0.01 ||
      Math.abs(clamped.y - current.y) > 0.01;

    if (!moved) {
      return false;
    }

    applyCanvasTransform({
      scale: current.scale,
      x: clamped.x,
      y: clamped.y,
    });
    return true;
  }, [applyCanvasTransform, clampCanvasTranslate]);

  useLayoutEffect(() => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
      return undefined;
    }

    const syncCanvasSize = () => {
      syncCanvasViewportBounds();
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
  }, [canvasViewportSyncRevision, syncCanvasViewportBounds]);

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

      setAppCanvasZoomingDataset(false);
    };
  }, []);


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
    if (!APP_CANVAS_ZOOM_ENABLED) {
      return;
    }

    window.localStorage.removeItem(STORAGE_KEYS.appZoom);
    let disposed = false;
    void setNativeAppZoom(NORMAL_APP_ZOOM).catch(() => {
      if (!disposed) reportZoomError();
    });
    return () => { disposed = true; };
  }, [reportZoomError]);

  useEffect(() => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
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
        restoreInnerScrollLocks();
        consumeAppZoomWheelEvent(event);
        return;
      }

      if (!isZoomWheel) {
        if (appZoomRef.current > NORMAL_APP_ZOOM + 0.0005) {
          captureInnerScrollLocks();
          const didPanCanvas = panZoomViewport(event.deltaX, event.deltaY);
          if (!didPanCanvas) {
            controlledInnerScroll(event.target, event.deltaX, event.deltaY);
          }
          restoreInnerScrollLocks();
          consumeAppZoomWheelEvent(event);
          return;
        }

        if (shouldLetEditorHandleWheel(event)) {
          return;
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
      if (document.querySelector(".image-viewer-overlay")) {
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
    const unlistenNativePinch = subscribeNativePinch(handleNativePinchPayload, reportZoomError);

    return () => {
      window.removeEventListener("wheel", handleAppZoomWheel, { capture: true });
      unlistenNativePinch();
    };
  }, [
    captureInnerScrollLocks,
    controlledInnerScroll,
    lockAppZoomScroll,
    panZoomViewport,
    restoreInnerScrollLocks,
    scheduleZoomAtPoint,
    scheduleZoomSettle,
    reportZoomError,
  ]);

  useEffect(() => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
      return undefined;
    }

    const isInnerScrollFrozen = () =>
      Date.now() < zoomScrollLockUntilRef.current ||
      appZoomRef.current > NORMAL_APP_ZOOM + 0.0005 ||
      Boolean(activeZoomAnchorRef.current) ||
      zoomRafRef.current !== 0 ||
      zoomSettleTimerRef.current !== null ||
      zoomSnapAnimationRef.current !== 0;

    const isTransientZoomScrollLocked = () =>
      Date.now() < zoomScrollLockUntilRef.current ||
      Boolean(activeZoomAnchorRef.current) ||
      zoomRafRef.current !== 0 ||
      zoomSettleTimerRef.current !== null ||
      zoomSnapAnimationRef.current !== 0;

    const handleScrollCapture = (event: Event) => {
      if (!isInnerScrollFrozen()) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        zoomInnerScrollLocksRef.current.has(target)
      ) {
        if (isTransientZoomScrollLocked()) {
          restoreInnerScrollLocks();
          return;
        }

        zoomInnerScrollLocksRef.current.set(target, {
          left: target.scrollLeft,
          top: target.scrollTop,
        });
      }
    };

    document.addEventListener("scroll", handleScrollCapture, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener("scroll", handleScrollCapture, { capture: true });
    };
  }, [restoreInnerScrollLocks]);

  useEffect(() => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
      return undefined;
    }

    const isAppCanvasInteractionLocked = () =>
      Date.now() < zoomScrollLockUntilRef.current ||
      Boolean(activeZoomAnchorRef.current) ||
      zoomRafRef.current !== 0 ||
      zoomSettleTimerRef.current !== null ||
      zoomSnapAnimationRef.current !== 0;

    const handlePointerCapture = (event: Event) => {
      if (!isAppCanvasInteractionLocked()) {
        if (appZoomRef.current > NORMAL_APP_ZOOM + 0.0005) {
          if (
            isAppZoomPointerLikeEvent(event) &&
            event.type === "mousedown" &&
            Date.now() - lastAppZoomCursorPlacementAtRef.current < 120 &&
            event.target instanceof Node &&
            editorViewRef.current &&
            (editorViewRef.current as unknown as EditorView).dom.contains(event.target)
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
          }

          if (isAppZoomPointerLikeEvent(event) && event.type === "pointerdown") {
            if (placeEditorCursorDuringAppZoom(event)) {
              return;
            }
          }
        }
        return;
      }

      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!zoomCanvasRef.current?.contains(target)) {
        return;
      }

      restoreInnerScrollLocks();
      consumeAppZoomPointerEvent(event);
    };

    const eventNames = [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "contextmenu",
    ] as const;

    eventNames.forEach((eventName) => {
      window.addEventListener(eventName, handlePointerCapture, {
        capture: true,
        passive: false,
      });
    });

    return () => {
      eventNames.forEach((eventName) => {
        window.removeEventListener(eventName, handlePointerCapture, { capture: true });
      });
    };
  }, [editorViewRef, placeEditorCursorDuringAppZoom, restoreInnerScrollLocks]);


  const runAppZoomCommand = useCallback((action: "in" | "out" | "reset") => {
    cancelZoomSnapAnimation();
    if (zoomRafRef.current) window.cancelAnimationFrame(zoomRafRef.current);
    zoomRafRef.current = 0;
    if (zoomSettleTimerRef.current !== null) window.clearTimeout(zoomSettleTimerRef.current);
    zoomSettleTimerRef.current = null;
    if (zoomScrollUnlockTimerRef.current !== null) window.clearTimeout(zoomScrollUnlockTimerRef.current);
    zoomScrollUnlockTimerRef.current = null;
    zoomScrollLockUntilRef.current = 0;
    pendingAnchorRef.current = null;
    activeZoomAnchorRef.current = null;
    lastNativeGestureAtRef.current = 0;

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

    if (zoom > NORMAL_APP_ZOOM + 0.0005) {
      setAppCanvasZoomingDataset(true);
      captureInnerScrollLocks();
      restoreInnerScrollLocks();
    } else {
      restoreInnerScrollLocks();
      releaseInnerScrollLocks();
      setAppCanvasZoomingDataset(false);
    }

    setStatusMessage(t("status.zoomPercent", { percent: Math.round(zoom * 100) }));
  }, [
    applyCanvasZoom,
    applyZoomAtAnchor,
    cancelZoomSnapAnimation,
    commitZoom,
    captureInnerScrollLocks,
    getAnchorCanvasPoint,
    releaseInnerScrollLocks,
    restoreInnerScrollLocks,
    setStatusMessage,
    t,
  ]);


  const shouldUseAppCanvasZoom = APP_CANVAS_ZOOM_ENABLED;
  const renderedAppZoom = shouldUseAppCanvasZoom
    ? appZoomRef.current
    : NORMAL_APP_ZOOM;
  const renderedCanvasPlacement = shouldUseAppCanvasZoom
    ? appCanvasPlacementRef.current
    : null;
  const renderedCanvasTransform = shouldUseAppCanvasZoom
    ? appCanvasTransformRef.current
    : { scale: NORMAL_APP_ZOOM, x: 0, y: 0 };
  const appZoomCanvasSizeStyle = {
    width: "100%",
    height: "100%",
  } satisfies CSSProperties;

  const appZoomCanvasStyle = {
    left: `${renderedCanvasPlacement?.offsetLeft ?? 0}px`,
    top: `${renderedCanvasPlacement?.offsetTop ?? 0}px`,
    width: shouldUseAppCanvasZoom ? `${appCanvasSize.width}px` : "100%",
    height: shouldUseAppCanvasZoom ? `${appCanvasSize.height}px` : "100%",
    transform: shouldUseAppCanvasZoom && (
      Math.abs(renderedCanvasTransform.scale - NORMAL_APP_ZOOM) > 0.0005 ||
      Math.abs(renderedCanvasTransform.x) > 0.0005 ||
      Math.abs(renderedCanvasTransform.y) > 0.0005
    )
      ? `translate3d(${renderedCanvasTransform.x}px, ${renderedCanvasTransform.y}px, 0) scale(${renderedAppZoom})`
      : "none",
  } satisfies CSSProperties;


  return { zoomViewportRef, zoomCanvasSizeRef, zoomCanvasRef, appZoomCanvasSizeStyle, appZoomCanvasStyle, requestCanvasViewportSync, runAppZoomCommand };
}
