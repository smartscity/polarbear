import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, parseLayoutPreferences } from "../../shared/settings/layoutPreferences";
import { maximumSidebarWidth, resolveWorkspaceLayout } from "./workspaceLayout";

describe("workspace layout constraints", () => {
  it("temporarily hides right then left and restores unchanged preferences", () => {
    const prefs = { ...DEFAULT_LAYOUT, leftWidth: 320, rightWidth: 280, rightOpen: true };
    expect(resolveWorkspaceLayout(1200, prefs, false)).toMatchObject({ left: 320, right: 280 });
    expect(resolveWorkspaceLayout(700, prefs, false)).toMatchObject({ left: 180, right: 0 });
    expect(resolveWorkspaceLayout(500, prefs, false)).toEqual({ left: 0, right: 0, center: 500 });
    expect(resolveWorkspaceLayout(1200, prefs, false)).toMatchObject({ left: 320, right: 280 });
  });
  it("never overflows narrow containers and reserves more room for split editing", () => {
    for (const split of [false, true]) for (let width = 0; width < 1600; width += 7) {
      const result = resolveWorkspaceLayout(width, { ...DEFAULT_LAYOUT, rightOpen: true }, split);
      expect(result.left + result.right + result.center + (result.left ? 6 : 0) + (result.right ? 6 : 0)).toBe(width);
      expect(result.center).toBeGreaterThanOrEqual(0);
    }
    expect(resolveWorkspaceLayout(1000, { ...DEFAULT_LAYOUT, rightOpen: true }, true).right).toBe(0);
  });
  it("limits one dragged side without resizing the other", () => {
    const layout = resolveWorkspaceLayout(1000, { ...DEFAULT_LAYOUT, rightOpen: true }, false);
    expect(maximumSidebarWidth("left", 1000, layout, false)).toBe(388);
    expect(maximumSidebarWidth("right", 1000, layout, false)).toBe(388);
  });
  it("validates corrupt and out-of-range preferences", () => {
    expect(parseLayoutPreferences({ leftWidth: Infinity, rightWidth: -1, rightOpen: true })).toEqual({ ...DEFAULT_LAYOUT, rightWidth: 180, rightOpen: true });
    expect(parseLayoutPreferences({ leftWidth: 999, rightWidth: 999 })).toMatchObject({ leftWidth: 420, rightWidth: 400 });
  });
});
