import { describe, expect, it } from "vitest";
import {
  clampCommittedZoom,
  clampInteractionZoom,
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
});
