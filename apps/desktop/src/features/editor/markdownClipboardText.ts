import MarkdownIt from "markdown-it";
import { translateCurrent } from "../../shared/i18n/translate";

/** Human-readable fallback preserves document order without leaking diagram source. */
export function markdownClipboardText(markdown: string): string {
  const tokens = new MarkdownIt({ html: false, linkify: true }).parse(markdown, {});
  const lists: { ordered: boolean; next: number }[] = [];
  let text = "";
  for (const token of tokens) {
    if (token.type === "inline") {
      for (const child of token.children ?? []) {
        if (["text", "code_inline", "image"].includes(child.type)) text += child.content;
        if (["softbreak", "hardbreak"].includes(child.type)) text += "\n";
      }
    } else if (token.type === "fence" || token.type === "code_block") {
      text += token.info.trim().split(/\s+/)[0].toLowerCase() === "mermaid"
        ? `${translateCurrent("clipboard.diagramPlaceholder")}\n\n` : `${token.content}\n`;
    } else if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      lists.push({ ordered: token.type === "ordered_list_open", next: Number(token.attrGet("start") ?? 1) });
    } else if (token.type.endsWith("list_close")) lists.pop();
    else if (token.type === "list_item_open") {
      const list = lists.at(-1);
      text += list?.ordered ? `${list.next++}. ` : "• ";
    } else if (token.type === "td_close" || token.type === "th_close") text += "\t";
    else if (token.type === "tr_close") text = `${text.replace(/\t+$/, "")}\n`;
    else if (["paragraph_close", "heading_close", "table_close", "blockquote_close"].includes(token.type)) text += lists.length ? "\n" : "\n\n";
  }
  return text.replace(/\n{3,}/g, "\n\n").trimEnd();
}
