import { afterEach, describe, expect, it, vi } from "vitest";
import { readPosition, readPositions, savePosition } from "./readingState";

afterEach(() => vi.unstubAllGlobals());

describe("persisted reading positions", () => {
  const valid = { anchor: "section", offset: 12, ratio: 0.5, openedAt: 42 };
  function storage(value: unknown) {
    let text = JSON.stringify(value);
    vi.stubGlobal("localStorage", { getItem: () => text, setItem: (_key: string, next: string) => { text = next; } });
  }
  it("keeps valid history and allows saving when another stored entry is null", () => {
    storage({ valid, broken: null });
    expect(readPositions()).toEqual({ valid });
    expect(() => savePosition("new", { ...valid, openedAt: 43 })).not.toThrow();
    expect(readPosition("valid")).toEqual(valid);
    expect(readPosition("new")?.openedAt).toBe(43);
    expect(readPosition("toString")).toBeNull();
  });
  it("rejects malformed records individually and normalizes out-of-range positions", () => {
    storage({ missing: {}, wrongTime: { ...valid, openedAt: "yesterday" }, negativeTime: { ...valid, openedAt: -1 },
      invalidAnchor: { ...valid, anchor: [] }, valid: { ...valid, ratio: 2, offset: -10 } });
    expect(readPositions()).toEqual({ valid: { ...valid, ratio: 1, offset: 0 } });
  });
  it("retains the 500 most recently opened documents after saving", () => {
    storage(Object.fromEntries(Array.from({ length: 500 }, (_, i) => [String(i), { ...valid, openedAt: i }])));
    savePosition("new", { ...valid, openedAt: 1000 });
    expect(Object.keys(readPositions())).toHaveLength(500);
    expect(readPosition("0")).toBeNull();
    expect(readPosition("new")?.openedAt).toBe(1000);
  });
});
