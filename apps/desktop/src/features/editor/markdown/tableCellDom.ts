export function normalizeTableCellText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t]+|[ \t]+$/g, "");
}

export function escapeMarkdownTableCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

export function renderTableCellValue(cell: HTMLElement, markdown: string): void {
  cell.replaceChildren();
  const lines = markdown.replace(/<br\s*\/?>/gi, "\n").split("\n");

  if (lines.length > 0 && lines.every((line) => /^\s*[-*]\s+\[[ xX]\]\s+/.test(line))) {
    const list = document.createElement("ul");
    list.className = "cm-typora-table-cell-list cm-typora-table-cell-task-list";
    lines.forEach((line) => {
      const item = document.createElement("li");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = /^\s*[-*]\s+\[[xX]\]\s+/.test(line);
      checkbox.disabled = true;
      checkbox.tabIndex = -1;
      checkbox.dataset.tableTaskMarker = "true";
      item.append(checkbox, document.createTextNode(" "));
      appendInlineMarkdown(item, line.replace(/^\s*[-*]\s+\[[ xX]\]\s+/, ""));
      list.append(item);
    });
    cell.append(list);
    return;
  }

  if (lines.length > 0 && lines.every((line) => /^\s*[-*]\s+/.test(line))) {
    const list = document.createElement("ul");
    list.className = "cm-typora-table-cell-list";
    lines.forEach((line) => {
      const item = document.createElement("li");
      appendInlineMarkdown(item, line.replace(/^\s*[-*]\s+/, ""));
      list.append(item);
    });
    cell.append(list);
    return;
  }

  if (lines.length > 0 && lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
    const list = document.createElement("ol");
    list.className = "cm-typora-table-cell-list";
    lines.forEach((line) => {
      const item = document.createElement("li");
      appendInlineMarkdown(item, line.replace(/^\s*\d+\.\s+/, ""));
      list.append(item);
    });
    cell.append(list);
    return;
  }

  if (lines.length > 0 && lines.every((line) => /^\s*>\s?/.test(line))) {
    const quote = document.createElement("blockquote");
    lines.forEach((line, index) => {
      appendInlineMarkdown(quote, line.replace(/^\s*>\s?/, ""));
      if (index < lines.length - 1) quote.append(document.createElement("br"));
    });
    cell.append(quote);
    return;
  }

  lines.forEach((line, index) => {
    appendInlineMarkdown(cell, line);
    if (index < lines.length - 1) cell.append(document.createElement("br"));
  });
}

export function markdownFromTableCellElement(cell: HTMLElement): string {
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }

    if (!(node instanceof HTMLElement)) {
      return "";
    }

    if (node.tagName === "BR") return "\n";
    if (node.tagName === "INPUT" && node.dataset.tableTaskMarker === "true") {
      return (node as HTMLInputElement).checked ? "[x] " : "[ ] ";
    }
    if (node.tagName === "IMG") {
      const alt = node.getAttribute("alt") ?? "";
      const src = node.getAttribute("src") ?? "";
      return src ? `![${alt}](${src})` : alt;
    }

    const text = Array.from(node.childNodes).map(serialize).join("");
    if (node.tagName === "B" || node.tagName === "STRONG") return text ? `**${text}**` : "";
    if (node.tagName === "I" || node.tagName === "EM") return text ? `*${text}*` : "";
    if (node.tagName === "S" || node.tagName === "DEL" || node.tagName === "STRIKE") return text ? `~~${text}~~` : "";
    if (node.tagName === "CODE") return text ? `\`${text}\`` : "";
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      return href ? `[${text}](${href})` : text;
    }
    if (node.tagName === "LI") return text;
    if (node.tagName === "UL") {
      return Array.from(node.children)
        .filter((child) => child.tagName === "LI")
        .map((child) => `- ${serialize(child)}`)
        .join("\n");
    }
    if (node.tagName === "OL") {
      return Array.from(node.children)
        .filter((child) => child.tagName === "LI")
        .map((child, index) => `${index + 1}. ${serialize(child)}`)
        .join("\n");
    }
    if (node.tagName === "BLOCKQUOTE") {
      return text.split("\n").map((line) => `> ${line}`).join("\n");
    }
    if (node.tagName === "DIV" || node.tagName === "P") return `${text}\n`;
    return text;
  };

  return normalizeTableCellText(Array.from(cell.childNodes).map(serialize).join(""));
}

export function insertLineBreakAtCurrentSelection(host?: HTMLElement): void {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const selectionIsInsideHost = !host || Boolean(
    range && host.contains(range.commonAncestorContainer),
  );

  if (!range || !selectionIsInsideHost) {
    if (!host) return;
    const lineBreak = document.createElement("br");
    host.append(lineBreak);
    placeCaretAtEnd(host);
    return;
  }

  range.deleteContents();
  const lineBreak = document.createElement("br");
  range.insertNode(lineBreak);
  range.setStartAfter(lineBreak);
  range.setEndAfter(lineBreak);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function placeCaretAtEnd(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function appendInlineMarkdown(parent: HTMLElement, markdown: string): void {
  const pattern = /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|<br\s*\/?>|\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*]+)\*)/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    if (match.index > cursor) {
      parent.append(document.createTextNode(markdown.slice(cursor, match.index)));
    }

    const token = match[0] ?? "";
    if (/^!\[/.test(token)) {
      const image = document.createElement("img");
      image.alt = match[2] ?? "";
      image.src = match[3] ?? "";
      image.loading = "lazy";
      parent.append(image);
    } else if (/^\[/.test(token)) {
      const link = document.createElement("a");
      link.href = match[5] ?? "";
      link.textContent = match[4] ?? "";
      link.rel = "noreferrer";
      link.target = "_blank";
      parent.append(link);
    } else if (/^<br/i.test(token)) {
      parent.append(document.createElement("br"));
    } else if (match[6] !== undefined) {
      const strong = document.createElement("strong");
      strong.textContent = match[6];
      parent.append(strong);
    } else if (match[7] !== undefined) {
      const deleted = document.createElement("del");
      deleted.textContent = match[7];
      parent.append(deleted);
    } else if (match[8] !== undefined) {
      const code = document.createElement("code");
      code.textContent = match[8];
      parent.append(code);
    } else {
      const emphasis = document.createElement("em");
      emphasis.textContent = match[9] ?? "";
      parent.append(emphasis);
    }

    cursor = match.index + token.length;
  }

  if (cursor < markdown.length) {
    parent.append(document.createTextNode(markdown.slice(cursor)));
  }
}
