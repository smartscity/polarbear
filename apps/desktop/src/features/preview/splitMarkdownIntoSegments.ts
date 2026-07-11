export type MarkdownSegment =
  | { type: "markdown"; content: string }
  | { type: "mermaid"; content: string; id: string }
  | { type: "plantuml"; content: string; id: string }
  | {
      type: "image";
      alt: string;
      content: string;
      id: string;
      src: string;
      title?: string;
    };

export function splitMarkdownIntoSegments(
  markdownContent: string
): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const fencePattern = /^```([^\n`]*)\n([\s\S]*?)^```[ \t]*$/gm;
  let lastIndex = 0;
  let mermaidIndex = 0;
  let plantUmlIndex = 0;
  let match = fencePattern.exec(markdownContent);

  while (match) {
    const [fullMatch, languageText, fenceContent] = match;
    const matchStart = match.index;

    if (matchStart > lastIndex) {
      pushMarkdownSegments(
        segments,
        markdownContent.slice(lastIndex, matchStart)
      );
    }

    const language = languageText.trim().split(/\s+/)[0].toLowerCase();

    if (language === "mermaid") {
      segments.push({
        type: "mermaid",
        content: fenceContent,
        id: `mermaid-${mermaidIndex}`
      });
      mermaidIndex += 1;
    } else if (["plantuml", "puml", "uml"].includes(language)) {
      segments.push({
        type: "plantuml",
        content: fenceContent,
        id: `plantuml-${plantUmlIndex}`
      });
      plantUmlIndex += 1;
    } else {
      pushMarkdownSegments(segments, fullMatch);
    }

    lastIndex = matchStart + fullMatch.length;
    match = fencePattern.exec(markdownContent);
  }

  if (lastIndex < markdownContent.length) {
    pushMarkdownSegments(segments, markdownContent.slice(lastIndex));
  }

  if (segments.length === 0) {
    return [{ type: "markdown", content: markdownContent }];
  }

  return segments.filter((segment) => segment.content.length > 0);
}

function pushMarkdownSegments(
  segments: MarkdownSegment[],
  markdownContent: string
) {
  const imagePattern = /!\[([^\]]*)]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
  let lastIndex = 0;
  let imageIndex = segments.filter((segment) => segment.type === "image").length;
  let match = imagePattern.exec(markdownContent);

  while (match) {
    const [rawMarkdown, alt, src, title] = match;
    const matchStart = match.index;

    if (matchStart > lastIndex) {
      segments.push({
        type: "markdown",
        content: markdownContent.slice(lastIndex, matchStart)
      });
    }

    segments.push({
      type: "image",
      alt,
      content: rawMarkdown,
      id: `image-${imageIndex}`,
      src,
      title
    });
    imageIndex += 1;
    lastIndex = matchStart + rawMarkdown.length;
    match = imagePattern.exec(markdownContent);
  }

  if (lastIndex < markdownContent.length) {
    segments.push({
      type: "markdown",
      content: markdownContent.slice(lastIndex)
    });
  }
}

