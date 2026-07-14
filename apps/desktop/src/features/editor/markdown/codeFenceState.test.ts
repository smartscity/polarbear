import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { canCompleteFenceBlockOnEnter } from "./codeFenceCommands";
import {
  findClosingFenceLine,
  findFenceBlockAt,
  hasClosingFenceImmediatelyAfter,
  isLineInsideExistingFenceBlock,
} from "./codeFenceState";

describe("code fence editor state", () => {
  const state = EditorState.create({
    doc: [
      "Before",
      "```typescript",
      "const value = 1;",
      "```",
      "After",
    ].join("\n"),
  });

  it("finds the matching closing fence and block range", () => {
    expect(findClosingFenceLine(state, 2, state.doc.line(2).text)?.number).toBe(4);
    expect(findFenceBlockAt(state, state.doc.line(3).from + 3)).toEqual({
      openLineNumber: 2,
      closeLineNumber: 4,
    });
  });

  it("recognizes whether a line is already inside a fenced block", () => {
    expect(isLineInsideExistingFenceBlock(state, 3)).toBe(true);
    expect(isLineInsideExistingFenceBlock(state, 5)).toBe(false);
  });

  it("does not complete a fence that already has an immediate close", () => {
    const completed = EditorState.create({ doc: "```\n```" });
    expect(hasClosingFenceImmediatelyAfter(completed, 1, "```"))
      .toBe(true);
  });
});

describe("code fence commands", () => {
  it("only completes an unfinished opening fence at the end of its line", () => {
    const incomplete = EditorState.create({
      doc: "```ts",
      selection: { anchor: 5 },
    });
    const alreadyClosed = EditorState.create({
      doc: "```\n```",
      selection: { anchor: 3 },
    });
    const middleOfLine = EditorState.create({
      doc: "```ts",
      selection: { anchor: 2 },
    });

    expect(canCompleteFenceBlockOnEnter(incomplete)).toBe(true);
    expect(canCompleteFenceBlockOnEnter(alreadyClosed)).toBe(false);
    expect(canCompleteFenceBlockOnEnter(middleOfLine)).toBe(false);
  });
});
