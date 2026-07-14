import { describe, expect, it } from "vitest";
import {
  hasPrimaryModifier,
  hasZoomModifier,
  isApplePlatform,
} from "./keyboard";

const commandEvent = { ctrlKey: false, metaKey: true };
const controlEvent = { ctrlKey: true, metaKey: false };

describe("keyboard platform adapter", () => {
  it("uses Command on Apple platforms and Control elsewhere", () => {
    expect(isApplePlatform("MacIntel")).toBe(true);
    expect(isApplePlatform("iPad")).toBe(true);
    expect(isApplePlatform("Win32")).toBe(false);

    expect(hasPrimaryModifier(commandEvent, "MacIntel")).toBe(true);
    expect(hasPrimaryModifier(controlEvent, "MacIntel")).toBe(false);
    expect(hasPrimaryModifier(commandEvent, "Win32")).toBe(false);
    expect(hasPrimaryModifier(controlEvent, "Win32")).toBe(true);
  });

  it("keeps browser pinch wheel eligible for zoom on every platform", () => {
    expect(hasZoomModifier(commandEvent)).toBe(true);
    expect(hasZoomModifier(controlEvent)).toBe(true);
    expect(hasZoomModifier({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});
