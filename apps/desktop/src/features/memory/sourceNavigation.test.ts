import { describe, expect, it, vi } from "vitest";
import {
  focusMemorySource,
  isMemorySourceTargetCurrent,
  sourceLineRangeOffsets,
} from "./sourceNavigation";
import type { MarkdownEditorView } from "../editor/components/MarkdownEditor";

describe("Memory source navigation", () => {
  it("rejects a navigation target after the workspace changes", () => {
    const target = { workspaceRoot: "/repo-a", relativePath: "policy.md" };
    expect(isMemorySourceTargetCurrent(target, "/repo-a")).toBe(true);
    expect(isMemorySourceTargetCurrent(target, "/repo-b")).toBe(false);
  });

  it("maps one-based source lines to exact editor offsets", () => {
    const markdown = "# Retry\n\nNever retry FAILED.\nManual review only.\n";
    expect(sourceLineRangeOffsets(markdown, 3, 4)).toEqual({
      from: 9,
      to: 48,
    });
  });

  it("bounds the last line and rejects stale starting locations", () => {
    expect(sourceLineRangeOffsets("one\ntwo", 2, 100)).toEqual({ from: 4, to: 7 });
    expect(sourceLineRangeOffsets("one\ntwo", 0, 1)).toBeNull();
    expect(sourceLineRangeOffsets("one\ntwo", 3, 3)).toBeNull();
  });

  it("allows callers to open a file without a precise line range", () => {
    expect(sourceLineRangeOffsets("one", undefined, undefined)).toBeNull();
  });

  it("prefers validated character offsets for an exact partial-line selection", () => {
    const dispatch = vi.fn();
    const focus = vi.fn();
    const editor = {
      state: { doc: { toString: () => "prefix exact evidence suffix" } },
      dispatch,
      focus,
    } as unknown as MarkdownEditorView;
    expect(focusMemorySource(editor, {
      workspaceRoot: "/repo",
      relativePath: "policy.md",
      startLine: 1,
      endLine: 1,
      startOffset: 7,
      endOffset: 21,
      expectedText: "exact evidence",
    })).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 7, head: 21 },
      scrollIntoView: true,
    });
  });

  it("refuses to focus a stale range whose current text no longer matches", () => {
    const dispatch = vi.fn();
    const focus = vi.fn();
    const editor = {
      state: { doc: { toString: () => "prefix changed evidence suffix" } },
      dispatch,
      focus,
    } as unknown as MarkdownEditorView;
    expect(focusMemorySource(editor, {
      workspaceRoot: "/repo",
      relativePath: "policy.md",
      startLine: 1,
      endLine: 1,
      startOffset: 7,
      endOffset: 23,
      expectedText: "exact evidence",
    })).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
