import MarkdownIt from "markdown-it";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { svgContentAsPngDataUrl } from "../diagram/diagramExport";
import { renderMermaidSvg } from "../diagram/mermaidRenderer";
import { splitMarkdownIntoSegments } from "../preview/splitMarkdownIntoSegments";

type MermaidImageRenderer = (source: string, index: number) => Promise<string>;

type ClipboardCacheEntry = {
  html: string | null;
};

const MAX_CACHE_ENTRIES = 3;
const PREPARE_DELAY_MS = 250;
const clipboardCache = new Map<string, ClipboardCacheEntry>();
const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

export const richMarkdownCopyExtension = ViewPlugin.fromClass(
  class {
    private prepareTimer: number | null = null;

    constructor(view: EditorView) {
      this.schedulePreparation(view.state.doc.toString());
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.schedulePreparation(update.state.doc.toString());
      }
    }

    destroy() {
      if (this.prepareTimer !== null) {
        window.clearTimeout(this.prepareTimer);
      }
    }

    private schedulePreparation(markdown: string) {
      if (this.prepareTimer !== null) {
        window.clearTimeout(this.prepareTimer);
      }
      this.prepareTimer = window.setTimeout(() => {
        this.prepareTimer = null;
        prepareRichMarkdownClipboard(markdown);
      }, PREPARE_DELAY_MS);
    }
  },
  {
    eventHandlers: {
      copy(event, view) {
        return copyEntireRichMarkdownDocument(event, view);
      },
    },
  },
);

export async function buildRichMarkdownClipboardHtml(
  markdown: string,
  renderMermaidImage: MermaidImageRenderer = renderMermaidAsPngDataUrl,
): Promise<string> {
  const segments = splitMarkdownIntoSegments(markdown);
  const renderedSegments = await Promise.all(
    segments.map(async (segment, index) => {
      if (segment.type === "mermaid") {
        try {
          const imageDataUrl = await renderMermaidImage(segment.content, index);
          return [
            '<figure style="margin: 1em 0;">',
            `<img alt="Mermaid diagram" src="${imageDataUrl}" style="display: block; max-width: 100%; height: auto;" />`,
            "</figure>",
          ].join("");
        } catch {
          return markdownRenderer.render(`\`\`\`mermaid\n${segment.content}\`\`\`\n`);
        }
      }

      if (segment.type === "plantuml") {
        return markdownRenderer.render(`\`\`\`plantuml\n${segment.content}\`\`\`\n`);
      }

      return markdownRenderer.render(segment.content);
    }),
  );

  return [
    "<!doctype html>",
    '<html><body><article data-polarbear-clipboard="rich-markdown">',
    ...renderedSegments,
    "</article></body></html>",
  ].join("");
}

export function isEntireDocumentSelected(view: EditorView): boolean {
  const selection = view.state.selection;
  if (selection.ranges.length !== 1 || view.state.doc.length === 0) return false;
  const range = selection.main;
  return range.from === 0 && range.to === view.state.doc.length;
}

function copyEntireRichMarkdownDocument(event: ClipboardEvent, view: EditorView): boolean {
  if (!event.clipboardData || !isEntireDocumentSelected(view)) return false;

  const markdown = view.state.doc.toString();
  if (!containsMermaid(markdown)) return false;

  const cached = clipboardCache.get(markdown);
  if (!cached?.html) {
    prepareRichMarkdownClipboard(markdown);
    return false;
  }

  try {
    event.clipboardData.setData("text/plain", markdown);
    event.clipboardData.setData("text/html", cached.html);
    try {
      event.clipboardData.setData("text/markdown", markdown);
    } catch {
      // Some WebViews only accept standard clipboard MIME types.
    }
    event.preventDefault();
    return true;
  } catch {
    return false;
  }
}

function prepareRichMarkdownClipboard(markdown: string): void {
  if (!containsMermaid(markdown) || clipboardCache.has(markdown)) return;

  const entry: ClipboardCacheEntry = { html: null };
  clipboardCache.set(markdown, entry);
  trimClipboardCache();
  void buildRichMarkdownClipboardHtml(markdown).then(
    (html) => {
      entry.html = html;
    },
    () => {
      clipboardCache.delete(markdown);
    },
  );
}

function containsMermaid(markdown: string): boolean {
  return splitMarkdownIntoSegments(markdown).some((segment) => segment.type === "mermaid");
}

async function renderMermaidAsPngDataUrl(source: string, index: number): Promise<string> {
  const svgContent = await renderMermaidSvg(
    `polarbear-clipboard-mermaid-${hashText(source)}-${index}`,
    source,
  );
  return svgContentAsPngDataUrl(svgContent);
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function trimClipboardCache(): void {
  while (clipboardCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = clipboardCache.keys().next().value;
    if (typeof oldestKey !== "string") return;
    clipboardCache.delete(oldestKey);
  }
}
