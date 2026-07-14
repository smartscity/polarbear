import type { MarkdownFormatCommand } from "../../../shared/commands/markdownFormatCommands";

export type MarkdownTextEdit = {
  nextText: string;
  selectionAnchor: number;
  selectionHead?: number;
};

export type MarkdownDocumentChange = {
  from: number;
  insert: string;
  to: number;
};

type SelectionRange = {
  from: number;
  to: number;
};

const headingCommands: Partial<Record<MarkdownFormatCommand, number>> = {
  "format.heading1": 1,
  "format.heading2": 2,
  "format.heading3": 3,
  "format.heading4": 4,
  "format.heading5": 5,
  "format.heading6": 6
};

export function applyMarkdownFormat(
  command: MarkdownFormatCommand,
  text: string,
  selection: SelectionRange
): MarkdownTextEdit | null {
  if (command in headingCommands) {
    return replaceCurrentLinePrefix(
      text,
      selection,
      `${"#".repeat(headingCommands[command] ?? 1)} `
    );
  }

  if (command === "format.paragraph") {
    return replaceCurrentLinePrefix(text, selection, "");
  }

  if (command === "format.bold") {
    return toggleSelectionWrap(text, selection, "**", "**", "bold");
  }

  if (command === "format.italic") {
    return toggleSelectionWrap(text, selection, "*", "*", "italic");
  }

  if (command === "format.underline") {
    return toggleSelectionWrap(text, selection, "<u>", "</u>", "underline");
  }

  if (command === "format.code") {
    return wrapSelection(text, selection, "`", "`", "code");
  }

  if (command === "format.link") {
    return wrapLink(text, selection);
  }

  if (command === "format.clearFormat") {
    return clearInlineFormat(text, selection);
  }

  if (command === "format.codeFence") {
    return insertBlock(text, selection, "```text\n", "\n```\n", "");
  }

  if (command === "format.mathBlock") {
    return insertBlock(text, selection, "$$\n", "\n$$\n", "");
  }

  if (command === "format.quote") {
    return replaceCurrentLinePrefix(text, selection, "> ");
  }

  if (command === "format.orderedList") {
    return replaceCurrentLinePrefix(text, selection, "1. ");
  }

  if (command === "format.unorderedList") {
    return replaceCurrentLinePrefix(text, selection, "- ");
  }

  if (command === "format.taskList") {
    return replaceCurrentLinePrefix(text, selection, "- [ ] ");
  }

  return null;
}

/**
 * Keeps editor formatting transactions local. Replacing a whole CodeMirror
 * document for a two-character wrapper invalidates more layout state than the
 * command actually changed and makes scroll/selection restoration fragile.
 */
export function minimalMarkdownDocumentChange(
  previousText: string,
  nextText: string,
): MarkdownDocumentChange | null {
  if (previousText === nextText) {
    return null;
  }

  let from = 0;
  const sharedPrefixLength = Math.min(previousText.length, nextText.length);
  while (
    from < sharedPrefixLength &&
    previousText.charCodeAt(from) === nextText.charCodeAt(from)
  ) {
    from += 1;
  }

  let previousTo = previousText.length;
  let nextTo = nextText.length;
  while (
    previousTo > from &&
    nextTo > from &&
    previousText.charCodeAt(previousTo - 1) === nextText.charCodeAt(nextTo - 1)
  ) {
    previousTo -= 1;
    nextTo -= 1;
  }

  return {
    from,
    insert: nextText.slice(from, nextTo),
    to: previousTo,
  };
}

function replaceCurrentLinePrefix(
  text: string,
  selection: SelectionRange,
  nextPrefix: string
): MarkdownTextEdit {
  const lineStart = text.lastIndexOf("\n", Math.max(0, selection.from - 1)) + 1;
  const lineEndIndex = text.indexOf("\n", selection.from);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const line = text.slice(lineStart, lineEnd);
  const lineWithoutMarkdownPrefix = line.replace(/^(#{1,6}\s+|>\s+|[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+\.\s+)/, "");
  const nextLine = `${nextPrefix}${lineWithoutMarkdownPrefix}`;

  return {
    nextText: `${text.slice(0, lineStart)}${nextLine}${text.slice(lineEnd)}`,
    selectionAnchor: lineStart + nextLine.length
  };
}

function wrapLink(
  text: string,
  selection: SelectionRange
): MarkdownTextEdit {
  const selectedText = text.slice(selection.from, selection.to) || "link";
  const insert = `[${selectedText}](url)`;
  const nextText = `${text.slice(0, selection.from)}${insert}${text.slice(selection.to)}`;
  const selectionAnchor = selection.from + 1;

  return {
    nextText,
    selectionAnchor,
    selectionHead: selectionAnchor + selectedText.length
  };
}

function clearInlineFormat(
  text: string,
  selection: SelectionRange
): MarkdownTextEdit | null {
  if (selection.from === selection.to) {
    return null;
  }

  const selectedText = text
    .slice(selection.from, selection.to)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<u>(.*?)<\/u>/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  return {
    nextText: `${text.slice(0, selection.from)}${selectedText}${text.slice(selection.to)}`,
    selectionAnchor: selection.from,
    selectionHead: selection.from + selectedText.length
  };
}

function wrapSelection(
  text: string,
  selection: SelectionRange,
  before: string,
  after: string,
  placeholder: string
): MarkdownTextEdit {
  const selectedText = text.slice(selection.from, selection.to) || placeholder;
  const nextText = `${text.slice(0, selection.from)}${before}${selectedText}${after}${text.slice(selection.to)}`;
  const selectionAnchor = selection.from + before.length;

  return {
    nextText,
    selectionAnchor,
    selectionHead: selectionAnchor + selectedText.length
  };
}

function toggleSelectionWrap(
  text: string,
  selection: SelectionRange,
  before: string,
  after: string,
  placeholder: string
): MarkdownTextEdit {
  const selectedText = text.slice(selection.from, selection.to);

  if (selectedText.startsWith(before) && selectedText.endsWith(after)) {
    const unwrapped = selectedText.slice(
      before.length,
      selectedText.length - after.length
    );

    return {
      nextText: `${text.slice(0, selection.from)}${unwrapped}${text.slice(selection.to)}`,
      selectionAnchor: selection.from,
      selectionHead: selection.from + unwrapped.length
    };
  }

  const beforeSelection = text.slice(
    Math.max(0, selection.from - before.length),
    selection.from
  );
  const afterSelection = text.slice(
    selection.to,
    Math.min(text.length, selection.to + after.length)
  );

  if (selectedText && beforeSelection === before && afterSelection === after) {
    const nextFrom = selection.from - before.length;
    const nextTo = selection.to + after.length;

    return {
      nextText: `${text.slice(0, nextFrom)}${selectedText}${text.slice(nextTo)}`,
      selectionAnchor: nextFrom,
      selectionHead: nextFrom + selectedText.length
    };
  }

  return wrapSelection(text, selection, before, after, placeholder);
}

function insertBlock(
  text: string,
  selection: SelectionRange,
  before: string,
  after: string,
  placeholder: string
): MarkdownTextEdit {
  const selectedText = text.slice(selection.from, selection.to) || placeholder;
  const nextText = `${text.slice(0, selection.from)}${before}${selectedText}${after}${text.slice(selection.to)}`;
  const selectionAnchor = selection.from + before.length;

  return {
    nextText,
    selectionAnchor,
    selectionHead: selectionAnchor + selectedText.length
  };
}
