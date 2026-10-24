import { EditorState } from "@codemirror/state";
import { findClosingFenceLine } from "../markdown/codeFenceState";
import { isCalloutStartLine, isFrontmatterDelimiter, isHorizontalRuleLine, isHtmlImageOnlyLine, isImageOnlyLine, isMathFenceLine, isTableRowLine, isTableSeparatorLine, parseCodeFenceLine } from "../markdown/liveMarkdownSyntax";

export type PreviewBlock = {
  from: number;
  id: string;
  to: number;
  language?: string;
  raw: string;
  source: string;
  type:
    | "blockquoteCallout"
    | "htmlImage"
    | "hr"
    | "image"
    | "math"
    | "mermaid"
    | "plantuml"
    | "table";
};

function makePreviewBlock(block: Omit<PreviewBlock, "id">): PreviewBlock {
  return {
    ...block,
    id: `${block.type}:${block.from}:${block.to}:${hashPreviewBlockSource(block.source || block.raw)}`,
  };
}

function hashPreviewBlockSource(source: string): string {
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export function collectPreviewBlocks(state: EditorState): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  const doc = state.doc;
  const frontmatterClosingLineNumber =
    doc.lines >= 2 && isFrontmatterDelimiter(doc.line(1).text)
      ? findFrontmatterClosingLine(state)?.number ?? 0
      : 0;
  let lineNumber = 1;

  while (lineNumber <= doc.lines) {
    const line = doc.line(lineNumber);
    const lineText = line.text;

    if (frontmatterClosingLineNumber > 0 && lineNumber <= frontmatterClosingLineNumber) {
      lineNumber += 1;
      continue;
    }

    if (isHorizontalRuleLine(lineText)) {
      blocks.push(makePreviewBlock({
        from: line.from,
        raw: lineText,
        source: lineText,
        to: line.to,
        type: "hr",
      }));
      lineNumber += 1;
      continue;
    }

    if (isMathFenceLine(lineText)) {
      const closingLine = findMathClosingLine(state, lineNumber);
      if (closingLine) {
        const sourceFrom = Math.min(line.to + 1, doc.length);
        const sourceTo = Math.max(sourceFrom, closingLine.from - 1);
        blocks.push(makePreviewBlock({
          from: line.from,
          raw: state.sliceDoc(line.from, closingLine.to),
          source: state.sliceDoc(sourceFrom, sourceTo),
          to: closingLine.to,
          type: "math",
        }));
        lineNumber = closingLine.number + 1;
        continue;
      }
    }

    if (isCalloutStartLine(lineText)) {
      const endLine = findBlockquoteEndLine(state, lineNumber);
      blocks.push(makePreviewBlock({
        from: line.from,
        raw: state.sliceDoc(line.from, endLine.to),
        source: state.sliceDoc(line.from, endLine.to),
        to: endLine.to,
        type: "blockquoteCallout",
      }));
      lineNumber = endLine.number + 1;
      continue;
    }

    const fenceInfo = parseCodeFenceLine(line.from, line.to, lineText);

    if (fenceInfo) {
      const closingLine = findClosingFenceLine(state, lineNumber, lineText);
      const language = fenceInfo.language.toLowerCase();

      if (
        closingLine &&
        (language === "mermaid" ||
          language === "plantuml" ||
          language === "puml" ||
          language === "uml")
      ) {
        const sourceFrom = Math.min(line.to + 1, doc.length);
        const sourceTo = Math.max(sourceFrom, closingLine.from - 1);
        const source = state.sliceDoc(sourceFrom, sourceTo);

        blocks.push(makePreviewBlock({
          from: line.from,
          language,
          raw: state.sliceDoc(line.from, closingLine.to),
          source,
          to: closingLine.to,
          type: language === "mermaid" ? "mermaid" : "plantuml",
        }));
        lineNumber = closingLine.number + 1;
        continue;
      }
    }

    if (fenceInfo) {
      // A fence owns its body, even when it is incomplete or not a diagram.
      const closingLine = findClosingFenceLine(state, lineNumber, lineText);
      lineNumber = closingLine ? closingLine.number + 1 : doc.lines + 1;
      continue;
    }

    if (isImageOnlyLine(lineText)) {
      blocks.push(makePreviewBlock({
        from: line.from,
        raw: lineText,
        source: lineText,
        to: line.to,
        type: "image",
      }));
      lineNumber += 1;
      continue;
    }

    if (isHtmlImageOnlyLine(lineText)) {
      blocks.push(makePreviewBlock({
        from: line.from,
        raw: lineText,
        source: lineText,
        to: line.to,
        type: "htmlImage",
      }));
      lineNumber += 1;
      continue;
    }

    const tableEndLine = findMarkdownTableEndLine(state, lineNumber);
    if (tableEndLine) {
      blocks.push(makePreviewBlock({
        from: line.from,
        raw: state.sliceDoc(line.from, tableEndLine.to),
        source: state.sliceDoc(line.from, tableEndLine.to),
        to: tableEndLine.to,
        type: "table",
      }));
      lineNumber = tableEndLine.number + 1;
      continue;
    }

    lineNumber += 1;
  }

  return blocks;
}

export function findFrontmatterClosingLine(state: EditorState) {
  for (let lineNumber = 2; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (isFrontmatterDelimiter(line.text)) {
      return line;
    }
  }

  return null;
}

function findMathClosingLine(state: EditorState, openingLineNumber: number) {
  for (
    let lineNumber = openingLineNumber + 1;
    lineNumber <= state.doc.lines;
    lineNumber += 1
  ) {
    const line = state.doc.line(lineNumber);
    if (isMathFenceLine(line.text)) {
      return line;
    }
  }

  return null;
}

function findBlockquoteEndLine(state: EditorState, startLineNumber: number) {
  let endLine = state.doc.line(startLineNumber);

  for (
    let lineNumber = startLineNumber + 1;
    lineNumber <= state.doc.lines;
    lineNumber += 1
  ) {
    const line = state.doc.line(lineNumber);
    if (!/^\s*>/.test(line.text)) {
      break;
    }
    endLine = line;
  }

  return endLine;
}

function findMarkdownTableEndLine(state: EditorState, startLineNumber: number) {
  if (startLineNumber + 1 > state.doc.lines) {
    return null;
  }

  const headerLine = state.doc.line(startLineNumber);
  const separatorLine = state.doc.line(startLineNumber + 1);

  if (!isTableRowLine(headerLine.text) || !isTableSeparatorLine(separatorLine.text)) {
    return null;
  }

  let endLine = separatorLine;

  for (
    let lineNumber = startLineNumber + 2;
    lineNumber <= state.doc.lines;
    lineNumber += 1
  ) {
    const line = state.doc.line(lineNumber);
    if (!isTableRowLine(line.text)) {
      break;
    }
    endLine = line;
  }

  return endLine;
}
