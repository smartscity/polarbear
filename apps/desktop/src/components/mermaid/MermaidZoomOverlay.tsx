import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type Point = {
  x: number;
  y: number;
};

type Transform = {
  scale: number;
  translate: Point;
};

export type MermaidZoomOverlayProps = {
  source: string;
  svgContent: string;
  onClose: () => void;
};

type TouchState = {
  initialDistance: number;
  initialScale: number;
  initialCenter: Point;
  contentPoint: Point;
};

type GestureState = {
  focus: Point;
  contentPoint: Point;
};

type NativePinchPayload = {
  delta: number;
  timestamp?: number;
  x?: number;
  y?: number;
  source?: string;
  viewWidth?: number;
  viewHeight?: number;
  state?: number;
};

const minScale = 0.2;
const maxScale = 64;
const nativePinchEventName = "polarbear-native-pinch";

// 保留“两指按住上下拖拽缩放”的手感。
const wheelZoomIntensity = 0.018;

// 只影响“两指张开/捏合”的原生 pinch 灵敏度。
const nativePinchSensitivity = 2.8;
const nativePinchGestureIdleResetMs = 700;

function isNativePinchEndState(state: unknown): boolean {
  if (typeof state === "number") {
    // NSEventPhaseEnded = 8, NSEventPhaseCancelled = 16.
    return (state & 8) !== 0 || (state & 16) !== 0;
  }

  if (typeof state === "string") {
    return ["ended", "end", "cancelled", "canceled", "failed"].includes(
      state.toLowerCase(),
    );
  }

  return false;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getContentPointAtFocus(scale: number, translate: Point, focus: Point): Point {
  return {
    x: (focus.x - translate.x) / scale,
    y: (focus.y - translate.y) / scale,
  };
}

function zoomToScaleAtLockedContentPoint(params: {
  contentPoint: Point;
  focus: Point;
  nextScale: number;
}): Transform {
  const clampedScale = clamp(params.nextScale, minScale, maxScale);

  return {
    scale: clampedScale,
    translate: {
      x: params.focus.x - params.contentPoint.x * clampedScale,
      y: params.focus.y - params.contentPoint.y * clampedScale
    }
  };
}

function getCanvasLocalPoint(
  event: { clientX?: number; clientY?: number },
  canvasElement: HTMLDivElement,
): Point {
  const rect = canvasElement.getBoundingClientRect();
  const clientX =
    typeof event.clientX === "number" && Number.isFinite(event.clientX) && event.clientX > 0
      ? event.clientX
      : rect.left + rect.width / 2;
  const clientY =
    typeof event.clientY === "number" && Number.isFinite(event.clientY) && event.clientY > 0
      ? event.clientY
      : rect.top + rect.height / 2;

  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function calculateResetTransform(
  canvasElement: HTMLDivElement | null,
  contentElement: HTMLDivElement | null
): Transform {
  const svgElement = contentElement?.querySelector<SVGSVGElement>("svg");
  if (!canvasElement || !svgElement) {
    return {
      scale: 1,
      translate: { x: 0, y: 0 }
    };
  }

  const viewportRect = canvasElement.getBoundingClientRect();
  const svgSize = getSvgIntrinsicSize(svgElement);
  const scale = 1;

  return {
    scale,
    translate: {
      x: (viewportRect.width - svgSize.width * scale) / 2,
      y: (viewportRect.height - svgSize.height * scale) / 2
    }
  };
}

function getSvgIntrinsicSize(svgElement: SVGSVGElement): {
  width: number;
  height: number;
} {
  const viewBox = svgElement.viewBox.baseVal;

  if (viewBox.width > 0 && viewBox.height > 0) {
    return {
      width: viewBox.width,
      height: viewBox.height
    };
  }

  const width = parseSvgLength(svgElement.getAttribute("width"));
  const height = parseSvgLength(svgElement.getAttribute("height"));

  if (width > 0 && height > 0) {
    return { width, height };
  }

  const fallbackRect = svgElement.getBoundingClientRect();
  return {
    width: fallbackRect.width,
    height: fallbackRect.height
  };
}

function parseSvgLength(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsedValue = Number.parseFloat(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

type TouchPointLike = {
  clientX: number;
  clientY: number;
};

type TouchListLike = {
  length: number;
  item?: (index: number) => TouchPointLike | null;
  [index: number]: TouchPointLike;
};

function getTouchAt(touches: TouchListLike, index: number): TouchPointLike | null {
  if (typeof touches.item === "function") {
    return touches.item(index);
  }

  return touches[index] ?? null;
}

function getTouchDistance(touches: TouchListLike) {
  const first = getTouchAt(touches, 0);
  const second = getTouchAt(touches, 1);

  if (!first || !second) {
    return 0;
  }

  const deltaX = second.clientX - first.clientX;
  const deltaY = second.clientY - first.clientY;
  return Math.hypot(deltaX, deltaY);
}

function getTouchCenter(touches: TouchListLike) {
  const first = getTouchAt(touches, 0);
  const second = getTouchAt(touches, 1);

  if (!first || !second) {
    return { x: 0, y: 0 };
  }

  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2
  };
}

export function MermaidZoomOverlay({
  source,
  svgContent,
  onClose
}: MermaidZoomOverlayProps) {
  const overlayRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<Point>({ x: 0, y: 0 });
  const translateStartRef = useRef<Point>({ x: 0, y: 0 });
  const touchStateRef = useRef<TouchState | null>(null);
  const nativeGestureStateRef = useRef<GestureState | null>(null);
  const nativeGestureResetTimerRef = useRef<number | null>(null);
  const transformRef = useRef<Transform>({
    scale: 1,
    translate: { x: 0, y: 0 }
  });
  const handledNativeEventsRef = useRef<WeakSet<Event>>(new WeakSet());
  const lastGestureAtRef = useRef(0);
  const lastScaleLabelUpdateRef = useRef(0);
  const [scaleLabel, setScaleLabel] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [clipboardStatus, setClipboardStatus] = useState<string>("");

  const writeContentTransform = (transform: Transform) => {
    const contentElement = contentRef.current;
    if (!contentElement) {
      return;
    }

    contentElement.style.transform = `translate3d(${transform.translate.x}px, ${transform.translate.y}px, 0) scale(${transform.scale})`;
  };

  const syncScaleLabel = (nextScale: number, force = false) => {
    const now = performance.now();
    if (force || now - lastScaleLabelUpdateRef.current > 80) {
      lastScaleLabelUpdateRef.current = now;
      setScaleLabel(nextScale);
    }
  };

  const applyTransformImmediate = (nextTransform: Transform, forceLabel = false) => {
    transformRef.current = nextTransform;
    writeContentTransform(nextTransform);
    syncScaleLabel(nextTransform.scale, forceLabel);
  };

  const applyTranslateImmediate = (nextTranslate: Point) => {
    applyTransformImmediate({
      scale: transformRef.current.scale,
      translate: nextTranslate
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    resetView();
  }, [svgContent]);

  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | null = null;

    void listen<NativePinchPayload>(nativePinchEventName, (event) => {
      if (!isMounted) {
        return;
      }

      const payload = event.payload;
      const canvasElement = canvasRef.current;
      if (!canvasElement || !Number.isFinite(payload.delta)) {
        return;
      }

      lastGestureAtRef.current = Date.now();
      const currentTransform = transformRef.current;
      const currentFocus = getCanvasLocalPoint(
        {
          clientX: typeof payload.x === "number" ? payload.x : undefined,
          clientY: typeof payload.y === "number" ? payload.y : undefined,
        },
        canvasElement,
      );
      const gestureState = nativeGestureStateRef.current ?? {
        focus: currentFocus,
        contentPoint: getContentPointAtFocus(
          currentTransform.scale,
          currentTransform.translate,
          currentFocus,
        ),
      };
      nativeGestureStateRef.current = gestureState;
      const nextScale = clamp(
        currentTransform.scale * Math.exp(payload.delta * nativePinchSensitivity),
        minScale,
        maxScale
      );
      const zoomResult = zoomToScaleAtLockedContentPoint({
        contentPoint: gestureState.contentPoint,
        focus: gestureState.focus,
        nextScale,
      });

      applyTransformImmediate(zoomResult);
      if (nativeGestureResetTimerRef.current !== null) {
        window.clearTimeout(nativeGestureResetTimerRef.current);
      }
      if (isNativePinchEndState(payload.state)) {
        nativeGestureStateRef.current = null;
        nativeGestureResetTimerRef.current = null;
        return;
      }

      nativeGestureResetTimerRef.current = window.setTimeout(() => {
        nativeGestureStateRef.current = null;
        nativeGestureResetTimerRef.current = null;
      }, nativePinchGestureIdleResetMs);
    })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch((error: unknown) => {
        console.error("[MermaidZoom] native pinch listener failed", error);
      });

    return () => {
      isMounted = false;
      if (nativeGestureResetTimerRef.current !== null) {
        window.clearTimeout(nativeGestureResetTimerRef.current);
        nativeGestureResetTimerRef.current = null;
      }
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const overlayElement = overlayRef.current;
    const canvasElement = canvasRef.current;
    if (!overlayElement || !canvasElement) {
      return;
    }

    const listenerOptions: AddEventListenerOptions = {
      capture: true,
      passive: false
    };

    const markHandledOnce = (event: Event): boolean => {
      if (handledNativeEventsRef.current.has(event)) {
        return true;
      }

      handledNativeEventsRef.current.add(event);
      return false;
    };

    const handleNativeWheel = (event: WheelEvent) => {
      if (markHandledOnce(event)) {
        return;
      }

      if (Date.now() - lastGestureAtRef.current < 120) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const effectiveDelta =
        event.deltaY !== 0
          ? event.deltaY
          : event.deltaZ !== 0
            ? event.deltaZ
            : event.deltaX;

      if (
        !event.metaKey &&
        !event.ctrlKey &&
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        applyTranslateImmediate({
          x: transformRef.current.translate.x - event.deltaX,
          y: transformRef.current.translate.y - event.deltaY
        });
        return;
      }

      const currentTransform = transformRef.current;
      const focus = getCanvasLocalPoint(event, canvasElement);
      const zoomResult = zoomToScaleAtLockedContentPoint({
        contentPoint: getContentPointAtFocus(
          currentTransform.scale,
          currentTransform.translate,
          focus,
        ),
        focus,
        nextScale: currentTransform.scale * Math.exp(-effectiveDelta * wheelZoomIntensity),
      });

      applyTransformImmediate(zoomResult);
    };

    const eventTargets: EventTarget[] = [
      overlayElement,
      canvasElement,
      document,
      window
    ];

    const wheelListener = handleNativeWheel as EventListener;

    for (const eventTarget of eventTargets) {
      eventTarget.addEventListener("wheel", wheelListener, listenerOptions);
    }

    return () => {
      for (const eventTarget of eventTargets) {
        eventTarget.removeEventListener("wheel", wheelListener, listenerOptions);
      }
    };
  }, []);

  function resetView() {
    const resetTransform = calculateResetTransform(
      canvasRef.current,
      contentRef.current
    );
    applyTransformImmediate(resetTransform, true);
  }

  const copySvg = async () => {
    try {
      await navigator.clipboard.writeText(svgContent);
      setClipboardStatus("Copied");
      window.setTimeout(() => setClipboardStatus(""), 1500);
    } catch (error) {
      setClipboardStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const exportSvg = () => {
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");

    downloadLink.href = objectUrl;
    downloadLink.download = "diagram.svg";
    downloadLink.click();
    URL.revokeObjectURL(objectUrl);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    translateStartRef.current = transformRef.current.translate;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || event.pointerType === "touch") {
      return;
    }

    applyTranslateImmediate({
      x: translateStartRef.current.x + event.clientX - dragStartRef.current.x,
      y: translateStartRef.current.y + event.clientY - dragStartRef.current.y
    });
  };

  const finishDragging = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 1) {
      dragStartRef.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      };
      translateStartRef.current = transformRef.current.translate;
      touchStateRef.current = null;
    }

    if (event.touches.length === 2) {
      const center = getTouchCenter(event.touches);
      const canvasElement = canvasRef.current;
      const currentTransform = transformRef.current;
      const initialCenter = canvasElement
        ? getCanvasLocalPoint({ clientX: center.x, clientY: center.y }, canvasElement)
        : center;
      touchStateRef.current = {
        initialDistance: getTouchDistance(event.touches),
        initialScale: currentTransform.scale,
        initialCenter,
        contentPoint: getContentPointAtFocus(
          currentTransform.scale,
          currentTransform.translate,
          initialCenter,
        ),
      };
    }
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (event.touches.length === 1 && !touchStateRef.current) {
      applyTranslateImmediate({
        x:
          translateStartRef.current.x +
          event.touches[0].clientX -
          dragStartRef.current.x,
        y:
          translateStartRef.current.y +
          event.touches[0].clientY -
          dragStartRef.current.y
      });
    }

    if (event.touches.length === 2 && touchStateRef.current) {
      const nextDistance = getTouchDistance(event.touches);
      const nextScale = clamp(
        touchStateRef.current.initialScale *
          (nextDistance / touchStateRef.current.initialDistance),
        minScale,
        maxScale
      );
      const canvasElement = canvasRef.current;

      if (!canvasElement) {
        return;
      }

      const zoomResult = zoomToScaleAtLockedContentPoint({
        contentPoint: touchStateRef.current.contentPoint,
        focus: touchStateRef.current.initialCenter,
        nextScale,
      });

      applyTransformImmediate(zoomResult, true);
    }
  };

  const handleTouchEnd = () => {
    touchStateRef.current = null;
    syncScaleLabel(transformRef.current.scale, true);
  };

  return (
    <section
      ref={overlayRef}
      className="mermaid-zoom-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Mermaid diagram viewer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="mermaid-zoom-toolbar">
        <span className="mermaid-zoom-scale">{Math.round(scaleLabel * 100)}%</span>
        {clipboardStatus ? (
          <span className="mermaid-zoom-status">{clipboardStatus}</span>
        ) : null}
        <button type="button" onClick={resetView}>
          Reset
        </button>
        <button type="button" onClick={() => void copySvg()}>
          Copy SVG
        </button>
        <button type="button" onClick={exportSvg}>
          Export SVG
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div
        ref={canvasRef}
        className={`mermaid-zoom-canvas ${isDragging ? "dragging" : ""}`}
        onDoubleClick={resetView}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDragging}
        onPointerCancel={finishDragging}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          ref={contentRef}
          className="mermaid-zoom-content"
          style={{
            transform: "translate3d(0px, 0px, 0) scale(1)"
          }}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>
      <details className="mermaid-zoom-source">
        <summary>Source</summary>
        <pre>{source}</pre>
      </details>
    </section>
  );
}
