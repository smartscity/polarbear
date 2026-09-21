import type { MarkdownEditorView } from "../editor/components/MarkdownEditor";

export type MemorySourceNavigationTarget = {
  workspaceRoot: string;
  relativePath: string;
  startLine?: number;
  endLine?: number;
  startOffset?: number;
  endOffset?: number;
  expectedText?: string;
};

export function isMemorySourceTargetCurrent(
  target: MemorySourceNavigationTarget,
  workspaceRoot: string,
): boolean {
  return target.workspaceRoot === workspaceRoot;
}

export function sourceLineRangeOffsets(
  markdown: string,
  startLine?: number,
  endLine?: number,
): { from: number; to: number } | null {
  if (startLine == null) return null;

  const lines = markdown.split("\n");
  if (!Number.isInteger(startLine) || startLine < 1 || startLine > lines.length) {
    return null;
  }

  const boundedEndLine = endLine == null
    ? startLine
    : Math.min(Math.max(startLine, endLine), lines.length);
  const from = lines.slice(0, startLine - 1).reduce(
    (offset, line) => offset + line.length + 1,
    0,
  );
  const selectedLines = lines.slice(startLine - 1, boundedEndLine);
  return {
    from,
    to: from + selectedLines.join("\n").length,
  };
}

export function focusMemorySource(
  editorView: MarkdownEditorView,
  target: MemorySourceNavigationTarget,
): boolean {
  const markdown = editorView.state.doc.toString();
  const hasOffsets = target.startOffset !== undefined && target.endOffset !== undefined;
  const range = hasOffsets
    && Number.isInteger(target.startOffset)
    && Number.isInteger(target.endOffset)
    && target.startOffset! >= 0
    && target.endOffset! > target.startOffset!
    && target.endOffset! <= markdown.length
    ? { from: target.startOffset!, to: target.endOffset! }
    : sourceLineRangeOffsets(markdown, target.startLine, target.endLine);
  if (!range) return false;
  if (target.expectedText !== undefined
    && markdown.slice(range.from, range.to) !== target.expectedText) {
    return false;
  }

  editorView.focus();
  editorView.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
  return true;
}
