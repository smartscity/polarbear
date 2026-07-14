import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { parseCodeFenceLine } from "./liveMarkdownSyntax";

export type CodeFenceBlock = {
  closeLineNumber: number;
  openLineNumber: number;
};

export function findClosingFenceLine(
  state: EditorState,
  openingLineNumber: number,
  openingLineText: string,
) {
  const marker = fenceMarkerForLine(openingLineText);

  for (
    let lineNumber = openingLineNumber + 1;
    lineNumber <= state.doc.lines;
    lineNumber += 1
  ) {
    const line = state.doc.line(lineNumber);
    if (line.text.trimStart().startsWith(marker)) {
      return line;
    }
  }

  return null;
}

export function hasClosingFenceImmediatelyAfter(
  state: EditorState,
  openingLineNumber: number,
  openingLineText: string,
): boolean {
  const nextLineNumber = openingLineNumber + 1;
  if (nextLineNumber > state.doc.lines) {
    return false;
  }

  return state.doc.line(nextLineNumber).text.trim() === fenceMarkerForLine(openingLineText);
}

export function isSelectionInsideFencedCode(view: EditorView): boolean {
  const position = view.state.selection.main.from;
  let insideFence = false;
  let fenceMarker = "";

  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    if (line.from > position) {
      return insideFence;
    }

    const fence = parseCodeFenceLine(line.from, line.to, line.text);
    if (fence && !insideFence) {
      insideFence = true;
      fenceMarker = fenceMarkerForLine(line.text);
      continue;
    }

    if (insideFence && line.text.trimStart().startsWith(fenceMarker)) {
      return position <= line.to;
    }
  }

  return insideFence;
}

export function isLineInsideExistingFenceBlock(
  state: EditorState,
  targetLineNumber: number,
): boolean {
  let insideFence = false;
  let fenceMarker = "";

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);

    if (lineNumber >= targetLineNumber) {
      return insideFence;
    }

    const fence = parseCodeFenceLine(line.from, line.to, line.text);
    if (fence && !insideFence) {
      insideFence = true;
      fenceMarker = fenceMarkerForLine(line.text);
      continue;
    }

    if (insideFence && line.text.trimStart().startsWith(fenceMarker)) {
      insideFence = false;
      fenceMarker = "";
    }
  }

  return false;
}

export function findFenceBlockAt(
  state: EditorState,
  position: number,
): CodeFenceBlock | null {
  let openLineNumber = 0;
  let insideFence = false;
  let fenceMarker = "";

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const fence = parseCodeFenceLine(line.from, line.to, line.text);

    if (fence && !insideFence) {
      insideFence = true;
      fenceMarker = fenceMarkerForLine(line.text);
      openLineNumber = lineNumber;

      if (position < line.from) {
        return null;
      }

      continue;
    }

    if (insideFence && line.text.trimStart().startsWith(fenceMarker)) {
      if (position >= state.doc.line(openLineNumber).from && position <= line.to) {
        return {
          closeLineNumber: lineNumber,
          openLineNumber,
        };
      }

      insideFence = false;
      fenceMarker = "";
      openLineNumber = 0;
    }

    if (line.from > position && !insideFence) {
      return null;
    }
  }

  return null;
}

function fenceMarkerForLine(lineText: string): "```" | "~~~" {
  return lineText.trimStart().startsWith("~~~") ? "~~~" : "```";
}
