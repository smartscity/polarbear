import MarkdownIt from "markdown-it";

export type PreviewResource =
  | { type: "mermaid"; content: string; id: string }
  | { type: "plantuml"; content: string; id: string }
  | { type: "image"; content: string; id: string; src: string; alt: string; title?: string };

export type MarkdownSegment = PreviewResource | { type: "html"; content: string };

/** The parser owns nesting and escaping; resource slots keep the surrounding HTML intact. */
export function splitMarkdownIntoSegments(
  source: string,
  renderer = new MarkdownIt({ html: false, linkify: true, typographer: true }),
): MarkdownSegment[] {
  const resources: PreviewResource[] = [];
  const rules = renderer.renderer.rules;
  const originalFence = rules.fence;
  const originalImage = rules.image;
  const add = (resource: PreviewResource, tag: "div" | "span") => {
    resources.push(resource);
    return `<${tag} data-preview-resource="${resource.id}"></${tag}>`;
  };
  rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();
    const type = language === "mermaid" ? "mermaid"
      : ["plantuml", "puml", "uml"].includes(language) ? "plantuml" : null;
    return type ? add({ type, content: token.content, id: `resource-${resources.length}` }, "div")
      : originalFence!(tokens, index, options, env, self);
  };
  rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    return add({
      type: "image", id: `resource-${resources.length}`, content: token.content,
      src: token.attrGet("src") ?? "", title: token.attrGet("title") ?? undefined,
      alt: self.renderInlineAsText(token.children ?? [], options, env),
    }, "span");
  };
  try {
    const content = renderer.render(source);
    return [{ type: "html", content }, ...resources];
  } finally {
    rules.fence = originalFence;
    rules.image = originalImage;
  }
}

