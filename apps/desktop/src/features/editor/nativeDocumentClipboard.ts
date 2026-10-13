import { isApplePlatform } from "../../shared/platform/keyboard";
import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { invokeTauri } from "../../shared/tauri/invokeTauri";

export type ClipboardCell = { id: number; row: number; column: number; columns: number };
export type ClipboardRun = { text?: string; png?: string; bold?: boolean; italic?: boolean; code?: boolean; heading?: number; link?: string; table?: ClipboardCell };

export function supportsNativeDocumentCopy(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && isApplePlatform();
}

// Walk inert, locally generated HTML. Do not load images or invoke HTML importers
// on the native side: neither clipboard preparation nor pasting should fetch URLs.
export function nativeClipboardRuns(html: string): ClipboardRun[] {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const runs: ClipboardRun[] = [];
  let tableId = 0;
  const newline = () => {
    if (runs.length && !runs.at(-1)?.text?.endsWith("\n")) runs.push({ text: "\n" });
  };
  const visit = (node: Node, style: ClipboardRun = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) runs.push({ ...style, text: node.textContent });
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "iframe", "object"].includes(tag)) return;
    if (tag === "table") {
      newline();
      const id = tableId++;
      const rows = Array.from(node.querySelectorAll("tr"));
      const columns = Math.max(1, ...rows.map((row) => row.children.length));
      rows.forEach((row, rowIndex) => Array.from(row.children).forEach((cell, column) => {
        const cellStyle = { ...style, table: { id, row: rowIndex, column, columns } };
        visit(cell, cellStyle);
        runs.push({ ...cellStyle, text: "\n" });
      }));
      return;
    }
    if (tag === "img") {
      const source = node.getAttribute("src") ?? "";
      if (source.startsWith("data:image/png;base64,")) runs.push({ png: source.slice("data:image/png;base64,".length) });
      else runs.push({ text: node.getAttribute("alt") || source });
      return;
    }
    if (tag === "br") { runs.push({ text: "\n" }); return; }
    const block = /^(p|h[1-6]|pre|blockquote|li|tr|table|hr)$/.test(tag);
    if (block) newline();
    if (tag === "li") {
      const ordered = node.parentElement?.tagName === "OL";
      const index = node.parentElement ? Array.from(node.parentElement.children).indexOf(node) : 0;
      const start = Number(node.parentElement?.getAttribute("start") ?? 1);
      runs.push({ text: ordered ? `${(Number.isFinite(start) ? start : 1) + index}. ` : "• " });
    }
    const nextStyle = { ...style, bold: style.bold || /^(strong|b|th|h[1-6])$/.test(tag),
      italic: style.italic || tag === "em" || tag === "i", code: style.code || tag === "code" || tag === "pre",
      heading: /^h[1-6]$/.test(tag) ? Number(tag[1]) : style.heading,
      link: tag === "a" && /^(https?:|mailto:)/i.test(node.getAttribute("href") ?? "") ? node.getAttribute("href") ?? undefined : style.link };
    for (const child of node.childNodes) visit(child, nextStyle);
    if (!style.table && (tag === "td" || tag === "th") && node.nextElementSibling) runs.push({ text: "\t" });
    if (block) newline();
  };
  for (const child of body.childNodes) visit(child);
  return runs;
}

export async function beginNativeDocumentCopy(markdown: string): Promise<number> {
  // Let the synchronous browser copy commit the plain-text fallback first.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return invokeTauri<number>(TAURI_COMMANDS.beginDocumentCopy, { markdown });
}

export async function writeNativeDocumentCopy(markdown: string, html: string, expectedChangeCount: number, plainText: string): Promise<void> {
  await invokeTauri(TAURI_COMMANDS.writeDocumentCopy, {
    document: { markdown, plainText, html, runs: nativeClipboardRuns(html), expectedChangeCount },
  });
}
