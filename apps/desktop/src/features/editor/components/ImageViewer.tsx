import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { useDismissOnEscape } from "../../../shared/hooks/useDismissOnEscape";
import { useStoredDebugEnabled } from "../../../shared/debug/useStoredDebugEnabled";
import { useI18n } from "../../../shared/i18n/I18nProvider";
import { hasZoomModifier } from "../../../shared/platform/keyboard";

type ImageViewerProps = {
  alt: string;
  src: string;
  title?: string;
  onClose: () => void;
};

type Point = {
  x: number;
  y: number;
};

type ImageTransform = {
  scale: number;
  translateX: number;
  translateY: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startTranslateX: number;
  startTranslateY: number;
};

type GestureState = {
  focus: Point;
  contentPoint: Point;
  initialScale: number;
};

type TouchState = {
  initialCenter: Point;
  initialDistance: number;
  initialScale: number;
  contentPoint: Point;
};

type WebKitGestureEvent = Event & {
  clientX?: number;
  clientY?: number;
  scale?: number;
};

type DebugState = {
  loadedAt: string;
  lastEvent: string;
  wheelCount: number;
  gestureCount: number;
  touchCount: number;
  pointerCount: number;
  currentScale: number;
  domTransform: string;
  computedTransform: string;
};

const minScale = 0.2;
const maxScale = 16;
const viewerPadding = 72;

// wheel 分支灵敏度。正常不要设成 100；0.02~0.05 已经很快。
const wheelZoomIntensity = 0.035;
const wheelZoomMinimumDelta = 2.5;

// WebKit/macOS gesture 分支灵敏度。你的“改 wheelZoomIntensity 还是慢”大概率走这里。
// raw scale 如果是 1.01，经过 exp((1.01 - 1) * 14) 约等于 1.15。
const gestureZoomSensitivity = 14;

const nativeEventHandledMark = "__polarbearImageViewerHandled";
const debugVersion = "ImageViewer DEBUG v20260611-zoom-trace";

export function ImageViewer({ alt, src, title, onClose }: ImageViewerProps) {
  const { t } = useI18n();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const didDragRef = useRef(false);
  const didInitialFitRef = useRef(false);
  const gestureStateRef = useRef<GestureState | null>(null);
  const lastGestureAtRef = useRef(0);
  const touchStateRef = useRef<TouchState | null>(null);
  const transformRef = useRef<ImageTransform>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });
  const eventStatsRef = useRef({
    wheelCount: 0,
    gestureCount: 0,
    touchCount: 0,
    pointerCount: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const debugEnabled = useStoredDebugEnabled();
  const [transform, setTransform] = useState<ImageTransform>(
    transformRef.current,
  );
  const [debugState, setDebugState] = useState<DebugState>({
    loadedAt: new Date().toLocaleTimeString(),
    lastEvent: "waiting for wheel / gesture / touch",
    wheelCount: 0,
    gestureCount: 0,
    touchCount: 0,
    pointerCount: 0,
    currentScale: 1,
    domTransform: "",
    computedTransform: "",
  });

  const logImageViewerDebug = useCallback((message: string, details?: unknown) => {
    if (debugEnabled) {
      console.info(message, details);
    }
  }, [debugEnabled]);

  const warnImageViewerDebug = useCallback((message: string, details?: unknown) => {
    if (debugEnabled) {
      console.warn(message, details);
    }
  }, [debugEnabled]);

  const updateDebugState = useCallback((partial: Partial<DebugState>) => {
    if (!debugEnabled) {
      return;
    }
    setDebugState((previous) => ({
      ...previous,
      ...partial,
      wheelCount: eventStatsRef.current.wheelCount,
      gestureCount: eventStatsRef.current.gestureCount,
      touchCount: eventStatsRef.current.touchCount,
      pointerCount: eventStatsRef.current.pointerCount,
      currentScale: transformRef.current.scale,
    }));
  }, [debugEnabled]);

  const applyTransform = useCallback(
    (nextTransform: ImageTransform, reason = "unknown") => {
      const previousTransform = transformRef.current;
      transformRef.current = nextTransform;
      setTransform(nextTransform);

      logImageViewerDebug("[ImageViewerZoom] applyTransform", {
        reason,
        previousScale: previousTransform.scale,
        nextScale: nextTransform.scale,
        previousTransform,
        nextTransform,
      });

      requestAnimationFrame(() => {
        const imageElement = imageRef.current;
        if (!imageElement) {
          warnImageViewerDebug("[ImageViewerZoom] imageRef missing after transform", {
            reason,
          });
          updateDebugState({
            lastEvent: `${reason}: imageRef missing`,
            domTransform: "missing imageRef",
            computedTransform: "missing imageRef",
          });
          return;
        }

        const computedTransform =
          window.getComputedStyle(imageElement).transform;
        logImageViewerDebug("[ImageViewerZoom] domTransform", {
          reason,
          inlineTransform: imageElement.style.transform,
          computedTransform,
          className: imageElement.className,
          naturalWidth: imageElement.naturalWidth,
          naturalHeight: imageElement.naturalHeight,
          boundingRect: rectToPlainObject(imageElement.getBoundingClientRect()),
        });
        updateDebugState({
          lastEvent: `${reason}: ${Math.round(nextTransform.scale * 100)}%`,
          domTransform: imageElement.style.transform,
          computedTransform,
        });
      });
    },
    [logImageViewerDebug, updateDebugState, warnImageViewerDebug],
  );

  const resetView = useCallback((): boolean => {
    const canvasElement = canvasRef.current;
    const imageElement = imageRef.current;

    if (!canvasElement || !imageElement || imageElement.naturalWidth === 0) {
      logImageViewerDebug("[ImageViewerZoom] resetView skipped", {
        hasCanvas: Boolean(canvasElement),
        hasImage: Boolean(imageElement),
        naturalWidth: imageElement?.naturalWidth,
        naturalHeight: imageElement?.naturalHeight,
      });
      return false;
    }

    const viewportRect = canvasElement.getBoundingClientRect();
    const fitScale = calculateFitScale({
      imageHeight: imageElement.naturalHeight,
      imageWidth: imageElement.naturalWidth,
      viewportHeight: viewportRect.height,
      viewportWidth: viewportRect.width,
    });

    applyTransform(
      {
        scale: fitScale,
        translateX:
          (viewportRect.width - imageElement.naturalWidth * fitScale) / 2,
        translateY:
          (viewportRect.height - imageElement.naturalHeight * fitScale) / 2,
      },
      "resetView",
    );
    return true;
  }, [applyTransform, logImageViewerDebug]);

  useLayoutEffect(() => {
    didInitialFitRef.current = false;
    if (resetView()) {
      didInitialFitRef.current = true;
    }
  }, [resetView, src]);

  useEffect(() => {
    logImageViewerDebug("[ImageViewerZoom] component loaded", {
      debugVersion,
      src,
      alt,
      userAgent: window.navigator.userAgent,
    });
    updateDebugState({
      lastEvent: `${debugVersion} loaded`,
    });
  }, [alt, logImageViewerDebug, src, updateDebugState]);

  useDismissOnEscape(onClose);

  useEffect(() => {
    const overlayElement = overlayRef.current;
    const canvasElement = canvasRef.current;

    if (!overlayElement || !canvasElement) {
      warnImageViewerDebug("[ImageViewerZoom] native listener install skipped", {
        hasOverlay: Boolean(overlayElement),
        hasCanvas: Boolean(canvasElement),
      });
      return;
    }

    const listenerOptions: AddEventListenerOptions = {
      capture: true,
      passive: false,
    };

    const handleNativeWheel = (event: WheelEvent) => {
      if (isNativeEventAlreadyHandled(event)) {
        return;
      }

      if (Date.now() - lastGestureAtRef.current < 120) {
        return;
      }

      if (!shouldHandleViewerEvent(event, overlayElement)) {
        return;
      }

      markNativeEventAsHandled(event);
      event.preventDefault();
      event.stopPropagation();

      eventStatsRef.current.wheelCount += 1;

      const currentTransform = transformRef.current;
      const isPinchWheel = isTrackpadPinchWheel(event);
      const eventInfo = getWheelEventInfo(event);

      logImageViewerDebug("[ImageViewerZoom] wheel", {
        ...eventInfo,
        isPinchWheel,
        currentScale: currentTransform.scale,
        target: getEventTargetName(event),
      });

      if (isPinchWheel) {
        const zoomDelta = getNormalizedWheelZoomDelta(event);
        const scaleRatio = Math.exp(zoomDelta * wheelZoomIntensity);
        const nextScale = clamp(
          currentTransform.scale * scaleRatio,
          minScale,
          maxScale,
        );
        const point = getWheelPointInCanvas(canvasElement, event);
        const nextTransform = zoomToScaleAtLockedContentPoint({
          contentPoint: getContentPointAtFocus(
            currentTransform.scale,
            {
              x: currentTransform.translateX,
              y: currentTransform.translateY,
            },
            point,
          ),
          focus: point,
          nextScale,
        });

        updateDebugState({
          lastEvent: `wheel pinch delta=${zoomDelta.toFixed(2)} ratio=${scaleRatio.toFixed(
            3,
          )} scale=${Math.round(nextScale * 100)}%`,
          currentScale: nextScale,
        });
        applyTransform(nextTransform, "wheel pinch");
        return;
      }

      const nextTransform = {
        ...currentTransform,
        translateX: currentTransform.translateX - event.deltaX,
        translateY: currentTransform.translateY - event.deltaY,
      };
      updateDebugState({
        lastEvent: `wheel pan dx=${event.deltaX.toFixed(2)} dy=${event.deltaY.toFixed(2)}`,
        currentScale: nextTransform.scale,
      });
      applyTransform(nextTransform, "wheel pan");
    };

    const handleGestureStart = (event: Event) => {
      if (isNativeEventAlreadyHandled(event)) {
        return;
      }

      if (!shouldHandleViewerEvent(event, overlayElement)) {
        return;
      }

      markNativeEventAsHandled(event);
      const gestureEvent = event as WebKitGestureEvent;
      gestureEvent.preventDefault();
      event.stopPropagation();

      const currentTransform = transformRef.current;
      const existingGestureState = gestureStateRef.current;
      const center = existingGestureState?.focus
        ?? getGesturePointInCanvas(canvasElement, gestureEvent);
      gestureStateRef.current = {
        focus: center,
        contentPoint:
          existingGestureState?.contentPoint ??
          getContentPointAtFocus(
            currentTransform.scale,
            {
              x: currentTransform.translateX,
              y: currentTransform.translateY,
            },
            center,
          ),
        initialScale: currentTransform.scale,
      };
      lastGestureAtRef.current = Date.now();
      eventStatsRef.current.gestureCount += 1;
      logImageViewerDebug("[ImageViewerZoom] gesturestart", {
        rawScale: gestureEvent.scale,
        initialScale: currentTransform.scale,
        center,
        clientX: gestureEvent.clientX,
        clientY: gestureEvent.clientY,
        target: getEventTargetName(event),
      });
      updateDebugState({
        lastEvent: `gesturestart scale=${Math.round(transformRef.current.scale * 100)}%`,
      });
    };

    const handleGestureChange = (event: Event) => {
      if (isNativeEventAlreadyHandled(event)) {
        return;
      }

      if (!shouldHandleViewerEvent(event, overlayElement)) {
        return;
      }

      markNativeEventAsHandled(event);
      const gestureEvent = event as WebKitGestureEvent;
      const gestureState = gestureStateRef.current;

      gestureEvent.preventDefault();
      event.stopPropagation();

      eventStatsRef.current.gestureCount += 1;
      lastGestureAtRef.current = Date.now();

      if (!gestureState) {
        warnImageViewerDebug("[ImageViewerZoom] gesturechange without gestureState", {
          rawScale: gestureEvent.scale,
          currentScale: transformRef.current.scale,
        });
        updateDebugState({
          lastEvent: `gesturechange without start raw=${formatNumber(gestureEvent.scale)}`,
        });
        return;
      }

      const rawGestureScale = sanitizeGestureScale(gestureEvent.scale);
      const acceleratedGestureScale = accelerateGestureScale(rawGestureScale);
      const nextScale = clamp(
        gestureState.initialScale * acceleratedGestureScale,
        minScale,
        maxScale,
      );
      const nextTransform = zoomToScaleAtLockedContentPoint({
        contentPoint: gestureState.contentPoint,
        focus: gestureState.focus,
        nextScale,
      });

      logImageViewerDebug("[ImageViewerZoom] gesturechange", {
        rawGestureScale,
        gestureZoomSensitivity,
        acceleratedGestureScale,
        initialScale: gestureState.initialScale,
        currentScale: transformRef.current.scale,
        nextScale,
        point: gestureState.focus,
        target: getEventTargetName(event),
      });
      updateDebugState({
        lastEvent: `gesturechange raw=${rawGestureScale.toFixed(
          4,
        )} accelerated=${acceleratedGestureScale.toFixed(3)} scale=${Math.round(
          nextScale * 100,
        )}%`,
        currentScale: nextScale,
      });
      applyTransform(nextTransform, "gesturechange");
    };

    const handleGestureEnd = (event: Event) => {
      if (isNativeEventAlreadyHandled(event)) {
        return;
      }

      if (!shouldHandleViewerEvent(event, overlayElement)) {
        return;
      }

      markNativeEventAsHandled(event);
      event.preventDefault();
      event.stopPropagation();
      eventStatsRef.current.gestureCount += 1;
      lastGestureAtRef.current = Date.now();
      logImageViewerDebug("[ImageViewerZoom] gestureend", {
        currentScale: transformRef.current.scale,
        target: getEventTargetName(event),
      });
      gestureStateRef.current = null;
      updateDebugState({
        lastEvent: `gestureend scale=${Math.round(transformRef.current.scale * 100)}%`,
      });
    };

    const eventTargets: EventTarget[] = [
      window,
      document,
      overlayElement,
      canvasElement,
    ];

    logImageViewerDebug("[ImageViewerZoom] native listeners installed", {
      targets: ["window", "document", "overlay", "canvas"],
      listenerOptions,
      wheelZoomIntensity,
      wheelZoomMinimumDelta,
      gestureZoomSensitivity,
    });

    const wheelListener = handleNativeWheel as EventListener;

    for (const eventTarget of eventTargets) {
      eventTarget.addEventListener("wheel", wheelListener, listenerOptions);
      eventTarget.addEventListener(
        "gesturestart",
        handleGestureStart,
        listenerOptions,
      );
      eventTarget.addEventListener(
        "gesturechange",
        handleGestureChange,
        listenerOptions,
      );
      eventTarget.addEventListener(
        "gestureend",
        handleGestureEnd,
        listenerOptions,
      );
    }

    return () => {
      for (const eventTarget of eventTargets) {
        eventTarget.removeEventListener(
          "wheel",
          wheelListener,
          listenerOptions,
        );
        eventTarget.removeEventListener(
          "gesturestart",
          handleGestureStart,
          listenerOptions,
        );
        eventTarget.removeEventListener(
          "gesturechange",
          handleGestureChange,
          listenerOptions,
        );
        eventTarget.removeEventListener(
          "gestureend",
          handleGestureEnd,
          listenerOptions,
        );
      }
      logImageViewerDebug("[ImageViewerZoom] native listeners removed");
    };
  }, [
    applyTransform,
    logImageViewerDebug,
    updateDebugState,
    warnImageViewerDebug,
  ]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    eventStatsRef.current.pointerCount += 1;
    logImageViewerDebug("[ImageViewerZoom] pointerdown", {
      pointerType: event.pointerType,
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
    });

    if (event.button !== 0 || event.pointerType === "touch") {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    didDragRef.current = false;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTranslateX: transformRef.current.translateX,
      startTranslateY: transformRef.current.translateY,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    if (
      Math.abs(event.clientX - dragState.startX) > 3 ||
      Math.abs(event.clientY - dragState.startY) > 3
    ) {
      didDragRef.current = true;
    }

    applyTransform(
      {
        ...transformRef.current,
        translateX:
          dragState.startTranslateX + event.clientX - dragState.startX,
        translateY:
          dragState.startTranslateY + event.clientY - dragState.startY,
      },
      "pointer drag",
    );
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setIsDragging(false);
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    eventStatsRef.current.touchCount += 1;
    logImageViewerDebug("[ImageViewerZoom] touchstart", {
      touchCount: event.touches.length,
      currentScale: transformRef.current.scale,
    });

    if (event.touches.length !== 2) {
      touchStateRef.current = null;
      return;
    }

    event.preventDefault();
    const center = getTouchCenter(event.touches);
    touchStateRef.current = {
      initialCenter: getPointInCanvas(event.currentTarget, center.x, center.y),
      initialDistance: getTouchDistance(event.touches),
      initialScale: transformRef.current.scale,
      contentPoint: getContentPointAtFocus(
        transformRef.current.scale,
        {
          x: transformRef.current.translateX,
          y: transformRef.current.translateY,
        },
        getPointInCanvas(event.currentTarget, center.x, center.y),
      ),
    };
  };

  const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    eventStatsRef.current.touchCount += 1;

    if (event.touches.length !== 2 || !touchStateRef.current) {
      return;
    }

    event.preventDefault();
    const touchState = touchStateRef.current;
    const nextDistance = getTouchDistance(event.touches);
    const nextScale = clamp(
      touchState.initialScale * (nextDistance / touchState.initialDistance),
      minScale,
      maxScale,
    );
    const nextTransform = zoomToScaleAtLockedContentPoint({
      contentPoint: touchState.contentPoint,
      focus: touchState.initialCenter,
      nextScale,
    });

    logImageViewerDebug("[ImageViewerZoom] touchmove", {
      nextDistance,
      initialDistance: touchState.initialDistance,
      initialScale: touchState.initialScale,
      nextScale,
    });

    applyTransform(nextTransform, "touch pinch");
  };

  return (
    <div
      ref={overlayRef}
      className="image-viewer-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="image-viewer-toolbar">
        <span className="image-viewer-scale">
          {Math.round(transform.scale * 100)}%
        </span>
        {debugEnabled ? (
          <span
            className="image-viewer-scale"
            style={{ color: "#fbbf24", minWidth: 260, textAlign: "left" }}
            title={debugState.lastEvent}
          >
            {debugVersion}
          </span>
        ) : null}
        <button type="button" onClick={resetView}>
          {t("common.reset")}
        </button>
        <button type="button" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
      <div
        ref={canvasRef}
        className={`image-viewer-canvas ${isDragging ? "dragging" : ""}`}
        onClick={(event) => {
          if (didDragRef.current) {
            didDragRef.current = false;
            return;
          }

          if (event.currentTarget === event.target) {
            onClose();
          }
        }}
        onDoubleClick={resetView}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
        onTouchEnd={() => {
          touchStateRef.current = null;
        }}
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
      >
        <img
          alt={alt}
          className="image-viewer-content"
          draggable={false}
          ref={imageRef}
          src={src}
          style={{
            transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`,
          }}
          title={title}
          onLoad={() => {
            if (!didInitialFitRef.current && resetView()) {
              didInitialFitRef.current = true;
            }
          }}
        />
        {debugEnabled ? (
          <div
            style={{
              position: "absolute",
              left: 12,
              bottom: 12,
              zIndex: 1200,
              maxWidth: "min(760px, calc(100vw - 24px))",
              padding: "10px 12px",
              border: "1px solid rgba(251, 191, 36, 0.5)",
              borderRadius: 8,
              color: "#fde68a",
              background: "rgba(2, 6, 23, 0.88)",
              fontFamily:
                '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
              fontSize: 12,
              lineHeight: 1.5,
              pointerEvents: "none",
              whiteSpace: "pre-wrap",
            }}
          >
            {`loaded: ${debugState.loadedAt}\nlast: ${debugState.lastEvent}\nscale: ${Math.round(
              transform.scale * 100,
            )}% / max ${maxScale * 100}%\ncounts: wheel=${debugState.wheelCount}, gesture=${debugState.gestureCount}, touch=${debugState.touchCount}, pointer=${debugState.pointerCount}\ninline: ${debugState.domTransform || "-"}\ncomputed: ${debugState.computedTransform || "-"}`}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function isNativeEventAlreadyHandled(event: Event): boolean {
  return Boolean(
    (event as unknown as Record<string, unknown>)[nativeEventHandledMark],
  );
}

function markNativeEventAsHandled(event: Event): void {
  try {
    Object.defineProperty(event, nativeEventHandledMark, {
      configurable: true,
      enumerable: false,
      value: true,
    });
  } catch {
    (event as unknown as Record<string, unknown>)[nativeEventHandledMark] =
      true;
  }
}

function shouldHandleViewerEvent(
  event: Event,
  overlayElement: HTMLElement,
): boolean {
  const target = event.target;

  if (!target) {
    return true;
  }

  if (target === window || target === document) {
    return true;
  }

  if (target instanceof Node) {
    return overlayElement.contains(target);
  }

  return true;
}

function isTrackpadPinchWheel(event: WheelEvent): boolean {
  return hasZoomModifier(event) || Math.abs(event.deltaZ) > 0;
}

function getNormalizedWheelZoomDelta(event: WheelEvent): number {
  const rawDelta = getWheelZoomDelta(event);
  const deltaModeMultiplier =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 120
        : 1;
  const pixelDelta = -rawDelta * deltaModeMultiplier;

  if (pixelDelta === 0) {
    return 0;
  }

  return (
    Math.sign(pixelDelta) *
    Math.max(Math.abs(pixelDelta), wheelZoomMinimumDelta)
  );
}

function getWheelZoomDelta(event: WheelEvent): number {
  if (event.deltaY !== 0) {
    return event.deltaY;
  }

  if (event.deltaZ !== 0) {
    return event.deltaZ;
  }

  return event.deltaX;
}

function sanitizeGestureScale(scale: number | undefined): number {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) {
    return 1;
  }

  return scale;
}

function accelerateGestureScale(rawGestureScale: number): number {
  return Math.exp((rawGestureScale - 1) * gestureZoomSensitivity);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function calculateFitScale({
  imageHeight,
  imageWidth,
  viewportHeight,
  viewportWidth,
}: {
  imageHeight: number;
  imageWidth: number;
  viewportHeight: number;
  viewportWidth: number;
}): number {
  if (imageHeight === 0 || imageWidth === 0) {
    return 1;
  }

  return clamp(
    Math.min(
      (viewportWidth - viewerPadding) / imageWidth,
      (viewportHeight - viewerPadding) / imageHeight,
      1,
    ),
    minScale,
    maxScale,
  );
}

function getContentPointAtFocus(
  scale: number,
  translate: Point,
  focus: Point,
): Point {
  return {
    x: (focus.x - translate.x) / scale,
    y: (focus.y - translate.y) / scale,
  };
}

function zoomToScaleAtLockedContentPoint({
  contentPoint,
  focus,
  nextScale,
}: {
  contentPoint: Point;
  focus: Point;
  nextScale: number;
}): ImageTransform {
  const clampedScale = clamp(nextScale, minScale, maxScale);

  return {
    scale: clampedScale,
    translateX: focus.x - contentPoint.x * clampedScale,
    translateY: focus.y - contentPoint.y * clampedScale,
  };
}

function getPointInCanvas(
  canvasElement: HTMLElement,
  clientX: number,
  clientY: number,
): Point {
  const viewportRect = canvasElement.getBoundingClientRect();

  return {
    x: clientX - viewportRect.left,
    y: clientY - viewportRect.top,
  };
}

function getWheelPointInCanvas(
  canvasElement: HTMLElement,
  event: WheelEvent,
): Point {
  const viewportRect = canvasElement.getBoundingClientRect();
  const hasClientPoint = event.clientX !== 0 || event.clientY !== 0;

  if (!hasClientPoint) {
    return {
      x: viewportRect.width / 2,
      y: viewportRect.height / 2,
    };
  }

  return getPointInCanvas(canvasElement, event.clientX, event.clientY);
}

function getGesturePointInCanvas(
  canvasElement: HTMLElement,
  event: WebKitGestureEvent,
  fallbackPoint?: Point,
): Point {
  if (
    typeof event.clientX !== "number" ||
    typeof event.clientY !== "number" ||
    event.clientX <= 0 ||
    event.clientY <= 0
  ) {
    if (fallbackPoint) {
      return fallbackPoint;
    }

    const viewportRect = canvasElement.getBoundingClientRect();
    return {
      x: viewportRect.width / 2,
      y: viewportRect.height / 2,
    };
  }

  return getPointInCanvas(canvasElement, event.clientX, event.clientY);
}

function getTouchDistance(touches: React.TouchList): number {
  const firstTouch = touches[0];
  const secondTouch = touches[1];
  const deltaX = secondTouch.clientX - firstTouch.clientX;
  const deltaY = secondTouch.clientY - firstTouch.clientY;

  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

function getTouchCenter(touches: React.TouchList): Point {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

function getWheelEventInfo(event: WheelEvent): Record<string, unknown> {
  return {
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    deltaMode: event.deltaMode,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    clientX: event.clientX,
    clientY: event.clientY,
  };
}

function getEventTargetName(event: Event): string {
  const target = event.target;

  if (target === window) {
    return "window";
  }

  if (target === document) {
    return "document";
  }

  if (target instanceof HTMLElement) {
    const className = target.className ? `.${String(target.className)}` : "";
    return `${target.tagName.toLowerCase()}${className}`;
  }

  if (target instanceof SVGElement) {
    return target.tagName.toLowerCase();
  }

  return String(target);
}

function rectToPlainObject(rect: DOMRect): Record<string, number> {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function formatNumber(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "undefined";
  }

  return value.toFixed(4);
}
