import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useEventCallback } from "../../shared/hooks/useEventCallback";
import { LAYOUT_LIMITS as L, type LayoutPreferences } from "../../shared/settings/layoutPreferences";
import { maximumSidebarWidth, resolveWorkspaceLayout, type SidebarSide } from "./workspaceLayout";

type Drag = { side: SidebarSide; pointer: number; target: HTMLElement; x: number; start: number; width: number; scale: number; max: number; cursor: string };

/** Pointer-frequency work is confined to CSS; preferences commit once on release. */
export function useWorkspaceResize(preferences: LayoutPreferences, split: boolean, onChange: (patch: Partial<LayoutPreferences>) => void) {
  const container = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  const [held, setHeld] = useState<{ width: number; split: boolean; expected: LayoutPreferences; displayed: LayoutPreferences } | null>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  // Hold the opposite compressed side only until the viewport or preferences change.
  const heldMatches = held?.width === width && held.split === split
    && Object.entries(held.expected).every(([key, value]) => preferences[key as keyof LayoutPreferences] === value);
  const effective = resolveWorkspaceLayout(width, heldMatches ? held.displayed : preferences, split);
  const commitWidth = (side: SidebarSide, next: number) => {
    const patch = side === "left" ? { leftWidth: next } : { rightWidth: next };
    const expected = { ...preferences, ...patch };
    setHeld({ width, split, expected, displayed: { ...expected,
      leftWidth: side === "left" ? next : effective.left,
      rightWidth: side === "right" ? next : effective.right,
      leftOpen: !!effective.left, rightOpen: !!effective.right,
    } });
    onChange(patch);
  };
  const apply = useEventCallback((left: number, right: number) => {
    const node = container.current;
    if (!node) return;
    node.style.setProperty("--workspace-left", `${left}px`);
    node.style.setProperty("--workspace-right", `${right}px`);
    node.style.setProperty("--workspace-left-gap", `${left ? L.separator : 0}px`);
    node.style.setProperty("--workspace-right-gap", `${right ? L.separator : 0}px`);
  });
  const finish = useEventCallback((commit: boolean) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    if (active.target.hasPointerCapture(active.pointer)) active.target.releasePointerCapture(active.pointer);
    document.body.style.cursor = active.cursor;
    delete container.current?.dataset.resizing;
    if (commit) commitWidth(active.side, active.width);
    else {
      apply(effective.left, effective.right);
      active.target.setAttribute("aria-valuenow", String(active.start));
    }
  });
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => {
      finish(false);
      setWidth(node.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const cancel = () => finish(false);
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); finish(false); }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape, true);
    return () => { observer.disconnect(); window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape, true); finish(false); };
  }, [finish]);
  useLayoutEffect(() => { finish(false); apply(effective.left, effective.right); }, [effective.left, effective.right, apply, finish]);

  const move = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointer) return;
    const delta = (event.clientX - active.x) / active.scale * (active.side === "left" ? 1 : -1);
    active.width = Math.round(Math.min(active.max, Math.max(L.minWidth, active.start + delta)));
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (drag.current !== active) return;
      apply(active.side === "left" ? active.width : effective.left, active.side === "right" ? active.width : effective.right);
      active.target.setAttribute("aria-valuenow", String(active.width));
    });
  };
  const keyDown = (side: SidebarSide, event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = (event.key === "ArrowRight" ? 1 : -1) * (side === "left" ? 1 : -1);
    const next = Math.max(L.minWidth, Math.min(maximumSidebarWidth(side, width, effective, split),
      effective[side] + direction * (event.shiftKey ? L.largeStep : L.step)));
    commitWidth(side, next);
  };
  const separatorProps = (side: SidebarSide) => ({
    role: "separator" as const, tabIndex: effective[side] ? 0 : -1,
    "aria-orientation": "vertical" as const,
    "aria-controls": side === "left" ? "workspace-sidebar" : "workspace-outline",
    "aria-valuenow": effective[side], "aria-valuemin": L.minWidth,
    "aria-valuemax": maximumSidebarWidth(side, width, effective, split),
    "aria-hidden": !effective[side],
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !effective[side] || !container.current) return;
      event.preventDefault(); event.stopPropagation();
      finish(false);
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { side, pointer: event.pointerId, target: event.currentTarget, x: event.clientX,
        start: effective[side], width: effective[side], max: maximumSidebarWidth(side, width, effective, split),
        scale: container.current.getBoundingClientRect().width / container.current.clientWidth || 1,
        cursor: document.body.style.cursor };
      container.current.dataset.resizing = side;
      document.body.style.cursor = "col-resize";
    },
    onPointerMove: move,
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (drag.current?.pointer !== event.pointerId) return;
      move(event); finish(true);
    },
    onPointerCancel: () => finish(false), onLostPointerCapture: () => finish(false),
    onDoubleClick: () => onChange(side === "left" ? { leftWidth: L.defaultWidth } : { rightWidth: L.defaultWidth }),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => keyDown(side, event),
  });
  return { container, effective, separatorProps, width };
}
