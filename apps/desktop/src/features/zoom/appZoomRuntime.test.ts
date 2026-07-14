import { describe, expect, it } from "vitest";
import {
  clampCommittedZoom,
  clampInteractionZoom,
  isAppZoomWheelEvent,
  isNativePinchEndPhase,
} from "./appZoomRuntime";
import { APP_ZOOM_CONFIG } from "./appZoomConfig";

describe("appZoomRuntime", () => {
  it("clamps committed and elastic interaction zoom independently", () => {
    expect(clampCommittedZoom(0.2)).toBe(1);
    expect(clampInteractionZoom(0.2)).toBe(APP_ZOOM_CONFIG.interactionMinimum);
    expect(clampCommittedZoom(99)).toBe(APP_ZOOM_CONFIG.maximum);
    expect(clampCommittedZoom(Number.NaN)).toBe(1);
  });

  it("recognizes native pinch completion phases", () => {
    expect(isNativePinchEndPhase(8)).toBe(true);
    expect(isNativePinchEndPhase(16)).toBe(true);
    expect(isNativePinchEndPhase("cancelled")).toBe(true);
    expect(isNativePinchEndPhase("changed")).toBe(false);
  });

  it("accepts both browser pinch modifier conventions", () => {
    const wheel = (modifiers: Pick<WheelEvent, "ctrlKey" | "metaKey">) => ({
      deltaX: 0,
      deltaY: 24,
      ...modifiers,
    }) as WheelEvent;

    expect(isAppZoomWheelEvent(wheel({ ctrlKey: true, metaKey: false }))).toBe(true);
    expect(isAppZoomWheelEvent(wheel({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isAppZoomWheelEvent(wheel({ ctrlKey: false, metaKey: false }))).toBe(false);
  });
});
