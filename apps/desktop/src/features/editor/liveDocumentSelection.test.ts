import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  clipSelectionRectangle,
  selectedVisibleLineRanges,
  selectionIntersectsBlock,
} from "./liveDocumentSelection";

describe("selectedVisibleLineRanges", () => {
  it("splits a reversed selection into document lines", () => {
    const state = EditorState.create({
      doc: "alpha\nbeta",
      selection: EditorSelection.range(9, 2),
    });

    expect(selectedVisibleLineRanges(state, [{ from: 0, to: 10 }])).toEqual([
      { from: 2, to: 5, newlineSelected: true },
      { from: 6, to: 9, newlineSelected: false },
    ]);
  });

  it("includes secondary selections while ignoring empty cursors", () => {
    const state = EditorState.create({
      doc: "one\ntwo\nthree",
      selection: EditorSelection.create([
        EditorSelection.range(2, 0),
        EditorSelection.cursor(5),
        EditorSelection.range(13, 9),
      ], 1),
      extensions: EditorState.allowMultipleSelections.of(true),
    });

    expect(selectedVisibleLineRanges(state, [{ from: 0, to: 13 }])).toEqual([
      { from: 0, to: 2, newlineSelected: false },
      { from: 9, to: 13, newlineSelected: false },
    ]);
  });

  it("leaves replaced preview source out of text selections", () => {
    const state = EditorState.create({
      doc: "alpha\nhidden source\nomega",
      selection: { anchor: 0, head: 25 },
    });

    expect(selectedVisibleLineRanges(state, [
      { from: 0, to: 6 },
      { from: 20, to: 25 },
    ])).toEqual([
      { from: 0, to: 5, newlineSelected: true },
      { from: 20, to: 25, newlineSelected: false },
    ]);
  });

  it("clips selected text to visible portions of each line", () => {
    const state = EditorState.create({
      doc: "0123456789\nabcdefghij",
      selection: { anchor: 2, head: 19 },
    });

    expect(selectedVisibleLineRanges(state, [
      { from: 4, to: 8 },
      { from: 13, to: 17 },
    ])).toEqual([
      { from: 4, to: 8, newlineSelected: false },
      { from: 13, to: 17, newlineSelected: false },
    ]);
  });

  it("preserves selected blank lines without selecting the trailing empty line", () => {
    const state = EditorState.create({
      doc: "ab\n\ncd\n",
      selection: { anchor: 0, head: 7 },
    });

    expect(selectedVisibleLineRanges(state, [{ from: 0, to: 7 }])).toEqual([
      { from: 0, to: 2, newlineSelected: true },
      { from: 3, to: 3, newlineSelected: true },
      { from: 4, to: 6, newlineSelected: true },
    ]);
  });

  it("represents a selected newline without including the next line", () => {
    const state = EditorState.create({
      doc: "ab\ncd",
      selection: { anchor: 2, head: 3 },
    });

    expect(selectedVisibleLineRanges(state, [{ from: 0, to: 5 }])).toEqual([
      { from: 2, to: 2, newlineSelected: true },
    ]);
  });

  it("does not mark an unselected newline or an adjacent visible range", () => {
    const state = EditorState.create({
      doc: "ab\ncd",
      selection: { anchor: 0, head: 2 },
    });

    expect(selectedVisibleLineRanges(state, [
      { from: 0, to: 2 },
      { from: 2, to: 5 },
    ])).toEqual([{ from: 0, to: 2, newlineSelected: false }]);
  });

  it("returns no text ranges for a cursor or an offscreen selection", () => {
    const cursorState = EditorState.create({ doc: "abc", selection: { anchor: 1 } });
    const selectedState = EditorState.create({
      doc: "abc\ndef",
      selection: { anchor: 0, head: 3 },
    });

    expect(selectedVisibleLineRanges(cursorState, [{ from: 0, to: 3 }])).toEqual([]);
    expect(selectedVisibleLineRanges(selectedState, [{ from: 4, to: 7 }])).toEqual([]);
    expect(selectedVisibleLineRanges(selectedState, [])).toEqual([]);
  });
});

describe("selectionIntersectsBlock", () => {
  const block = { from: 10, to: 20 };

  it("recognizes partial, complete, and reversed selection overlaps", () => {
    for (const range of [
      EditorSelection.range(5, 12),
      EditorSelection.range(18, 25),
      EditorSelection.range(10, 20),
      EditorSelection.range(0, 30),
      EditorSelection.range(17, 13),
    ]) {
      expect(selectionIntersectsBlock([range], block)).toBe(true);
    }
  });

  it("checks every range even when the main range is empty", () => {
    expect(selectionIntersectsBlock([
      EditorSelection.cursor(0),
      EditorSelection.range(25, 15),
    ], block)).toBe(true);
  });

  it("does not select a block for cursors or boundary-only contact", () => {
    for (const range of [
      EditorSelection.cursor(10),
      EditorSelection.cursor(15),
      EditorSelection.cursor(20),
      EditorSelection.range(0, 10),
      EditorSelection.range(20, 30),
    ]) {
      expect(selectionIntersectsBlock([range], block)).toBe(false);
    }
    expect(selectionIntersectsBlock([], block)).toBe(false);
  });

  it("rejects malformed and empty block boundaries", () => {
    for (const invalidBlock of [
      { from: 10, to: 10 },
      { from: 20, to: 10 },
      { from: Number.NaN, to: 20 },
      { from: 10, to: Number.NaN },
      { from: Number.NEGATIVE_INFINITY, to: 20 },
      { from: 10, to: Number.POSITIVE_INFINITY },
    ]) {
      expect(selectionIntersectsBlock([EditorSelection.range(0, 30)], invalidBlock)).toBe(false);
    }
  });
});

describe("clipSelectionRectangle", () => {
  const bounds = { left: 10, top: 20, right: 80, bottom: 60 };

  it("clips overflowing highlights to the text line on every side", () => {
    expect(clipSelectionRectangle({ left: 0, top: 5, right: 100, bottom: 90 }, bounds))
      .toEqual(bounds);
    expect(clipSelectionRectangle({ left: 5, top: 30, right: 40, bottom: 80 }, bounds))
      .toEqual({ left: 10, top: 30, right: 40, bottom: 60 });
  });

  it("preserves a contained rectangle without mutating its inputs", () => {
    const rect = Object.freeze({ left: 20, top: 30, right: 40, bottom: 50 });
    const frozenBounds = Object.freeze({ ...bounds });

    expect(clipSelectionRectangle(rect, frozenBounds)).toEqual(rect);
    expect(frozenBounds).toEqual(bounds);
  });

  it("rejects disjoint, touching, empty, and reversed rectangles", () => {
    for (const rect of [
      { left: 0, top: 25, right: 5, bottom: 40 },
      { left: 20, top: 0, right: 40, bottom: 15 },
      { left: 80, top: 25, right: 90, bottom: 40 },
      { left: 20, top: 60, right: 40, bottom: 80 },
      { left: 20, top: 30, right: 20, bottom: 50 },
      { left: 20, top: 30, right: 40, bottom: 30 },
      { left: 40, top: 30, right: 20, bottom: 50 },
    ]) {
      expect(clipSelectionRectangle(rect, bounds)).toBeNull();
    }
  });

  it("retains fractional coordinates used by zoomed editor layers", () => {
    expect(clipSelectionRectangle(
      { left: 4.25, top: 12.5, right: 30.75, bottom: 28.125 },
      { left: 9.5, top: 10.25, right: 24.125, bottom: 35.75 },
    )).toEqual({ left: 9.5, top: 12.5, right: 24.125, bottom: 28.125 });
  });
});
