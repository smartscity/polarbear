export function normalizeTableCellText(text: string): string {
  return text.replace(/\u00a0/g, " ").trim();
}

export function escapeMarkdownTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

export function renderTableCellValue(cell: HTMLElement, markdown: string): void {
  cell.replaceChildren();
  const pattern = /(<br\s*\/?>|\*\*([^*]+)\*\*)/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    if (match.index > cursor) {
      cell.append(document.createTextNode(markdown.slice(cursor, match.index)));
    }

    if (/^<br/i.test(match[0])) {
      cell.append(document.createElement("br"));
    } else {
      const strong = document.createElement("strong");
      strong.textContent = match[2] ?? "";
      cell.append(strong);
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < markdown.length) {
    cell.append(document.createTextNode(markdown.slice(cursor)));
  }
}

export function markdownFromTableCellElement(cell: HTMLElement): string {
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }

    if (!(node instanceof HTMLElement)) {
      return "";
    }

    if (node.tagName === "BR") {
      return "\n";
    }

    const text = Array.from(node.childNodes).map(serialize).join("");
    if (node.tagName === "B" || node.tagName === "STRONG") {
      return text ? `**${text}**` : "";
    }

    return text;
  };

  return normalizeTableCellText(Array.from(cell.childNodes).map(serialize).join(""));
}

export function insertLineBreakAtCurrentSelection(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const lineBreak = document.createElement("br");
  range.insertNode(lineBreak);
  range.setStartAfter(lineBreak);
  range.setEndAfter(lineBreak);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function placeCaretAtEnd(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
