import { describe, expect, it } from "vitest";
import { displayAccelerator, hasPrimaryModifier, hasZoomModifier, isApplePlatform } from "./keyboard";

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

it("formats configured accelerators as Apple symbols without changing other platforms", () => {
  expect(displayAccelerator("CmdOrCtrl+Alt+L", { symbols: true, platformHint: "MacIntel" })).toBe("\u2318\u2325L");
  expect(displayAccelerator("CmdOrCtrl+Shift+L", { symbols: true, platformHint: "iPad" })).toBe("\u2318\u21e7L");
  expect(displayAccelerator("CmdOrCtrl+Alt+L", { symbols: true, platformHint: "Win32" })).toBe("Control+Alt+L");
  expect(displayAccelerator(undefined, { symbols: true })).toBe("");
});
