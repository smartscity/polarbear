import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false });

/** Source excerpts may stop before the closing emphasis marker in the original paragraph. */
export function readingPlainText(source: string): string {
  let text = source.trim();
  for (const marker of ["**", "__"]) {
    if (text.startsWith(marker) && text.indexOf(marker, marker.length) < 0) text += marker;
  }
  return markdown.parseInline(text, {}).flatMap((token) => token.children ?? []).map((token) => {
    if (["text", "code_inline", "image"].includes(token.type)) return token.content;
    return ["softbreak", "hardbreak"].includes(token.type) ? "\n" : "";
  }).join("");
}

export function readingSourceTitle(title: string, heading: string): string {
  const filename = title.replace(/\.md$/iu, "");
  const comparable = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return heading && comparable(heading) !== comparable(filename)
    ? `${readingPlainText(filename)} · ${readingPlainText(heading)}`
    : readingPlainText(heading || filename);
}
