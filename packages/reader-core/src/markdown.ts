import MarkdownIt from "markdown-it";
import Token from "markdown-it/lib/token.mjs";

export type ReaderHeading = { id: string; title: string; level: number };
export type ReaderDiagram = { id: string; language: "mermaid" | "plantuml"; source: string };
export type ReaderImage = { id: string; source: string; alt: string };
export type ReaderDocument = {
  html: string;
  headings: ReaderHeading[];
  diagrams: ReaderDiagram[];
  images: ReaderImage[];
};

/** Parse one document, preserving list/table nesting and reference definitions. */
export function renderReaderMarkdown(source: string): ReaderDocument {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  const headings: ReaderHeading[] = [];
  const diagrams: ReaderDiagram[] = [];
  const images: ReaderImage[] = [];
  const usedIds = new Map<string, number>();
  md.inline.ruler.before("html_inline", "reader-line-break", (state, silent) => {
    const match = /^<br\s*\/?>/i.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) state.push("hardbreak", "br", 0);
    state.pos += match[0].length;
    return true;
  });
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s/)[0].toLowerCase();
    if (!["mermaid", "plantuml", "puml", "uml"].includes(language)) {
      return fence(tokens, index, options, env, self);
    }
    const id = `reader-diagram-${diagrams.length}`;
    diagrams.push({ id, language: language === "mermaid" ? "mermaid" : "plantuml", source: token.content });
    return `<div data-reader-diagram="${id}"></div>`;
  };
  md.renderer.rules.image = (tokens, index) => {
    const token = tokens[index];
    const id = `reader-image-${images.length}`;
    images.push({ id, source: token.attrGet("src") ?? "", alt: token.content });
    // Never put untrusted image URLs into the DOM before the resource policy runs.
    return `<span data-reader-image="${id}"></span>`;
  };
  const tokens = md.parse(source.replace(/^\uFEFF/, ""), {});
  tokens.forEach((token, index) => {
    if (token.type !== "inline" || tokens[index - 1]?.type !== "paragraph_open" || tokens[index - 2]?.type !== "list_item_open") return;
    const first = token.children?.[0];
    const match = first?.type === "text" ? /^\[([ xX])]\s+/.exec(first.content) : null;
    if (!first || !match) return;
    first.content = first.content.slice(match[0].length);
    const checkbox = new Token("html_inline", "", 0);
    checkbox.content = `<input type="checkbox" disabled${match[1].toLowerCase() === "x" ? " checked" : ""}> `;
    token.children?.unshift(checkbox);
  });
  tokens.forEach((token, index) => {
    if (token.type !== "heading_open") return;
    const inline = tokens[index + 1];
    const title = inline?.children?.map((child) => child.content).join("") ?? inline?.content ?? "";
    const base = title.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-") || "section";
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    const id = count ? `${base}-${count}` : base;
    token.attrSet("id", id);
    headings.push({ id, title, level: Number(token.tag.slice(1)) });
  });
  return { html: md.renderer.render(tokens, md.options, {}), headings, diagrams, images };
}
