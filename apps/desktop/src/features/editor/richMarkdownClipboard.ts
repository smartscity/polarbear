import MarkdownIt from "markdown-it";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { svgContentAsPngDataUrl } from "../diagram/diagramExport";
import { renderMermaidSvg } from "../diagram/mermaidRenderer";
import { splitMarkdownIntoSegments } from "../preview/splitMarkdownIntoSegments";

type MermaidImageRenderer = (source: string, index: number) => Promise<string>;
type BeforeMermaidRender = () => Promise<void>;

type ClipboardCacheEntry = {
  html: string | null;
};

const MAX_CACHE_ENTRIES = 3;
const PREPARE_DELAY_MS = 250;
const SCROLL_QUIET_MS = 180;
const clipboardCache = new Map<string, ClipboardCacheEntry>();
let lastEditorScrollAt = 0;
const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

export const richMarkdownCopyExtension = ViewPlugin.fromClass(
  class {
    private readonly view: EditorView;
    private prepareTimer: number | null = null;
    private preparationRevision = 0;
    private readonly onScroll = () => {
      lastEditorScrollAt = Date.now();
    };

    constructor(view: EditorView) {
      this.view = view;
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      this.schedulePreparation(view.state.doc.toString());
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.schedulePreparation(update.state.doc.toString());
      }
    }

    destroy() {
      this.preparationRevision += 1;
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      if (this.prepareTimer !== null) {
        window.clearTimeout(this.prepareTimer);
      }
    }

    private schedulePreparation(markdown: string) {
      const revision = ++this.preparationRevision;
      if (this.prepareTimer !== null) {
        window.clearTimeout(this.prepareTimer);
      }
      this.prepareTimer = window.setTimeout(() => {
        this.prepareTimer = null;
        prepareRichMarkdownClipboard(markdown, () => this.preparationRevision === revision);
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
  beforeMermaidRender: BeforeMermaidRender = async () => {},
): Promise<string> {
  const segments = splitMarkdownIntoSegments(markdown);
  const renderedSegments: string[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.type === "mermaid") {
      await beforeMermaidRender();
      try {
        const imageDataUrl = await renderMermaidImage(segment.content, index);
        renderedSegments.push([
          '<figure style="margin: 1em 0;">',
          `<img alt="Mermaid diagram" src="${imageDataUrl}" style="display: block; max-width: 100%; height: auto;" />`,
          "</figure>",
        ].join(""));
      } catch {
        renderedSegments.push(markdownRenderer.render(`\`\`\`mermaid\n${segment.content}\`\`\`\n`));
      }
      continue;
    }

    if (segment.type === "plantuml") {
      renderedSegments.push(markdownRenderer.render(`\`\`\`plantuml\n${segment.content}\`\`\`\n`));
      continue;
    }

    renderedSegments.push(markdownRenderer.render(segment.content));
  }

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

function prepareRichMarkdownClipboard(markdown: string, isCurrent = () => true): void {
  if (!containsMermaid(markdown) || clipboardCache.has(markdown)) return;

  const entry: ClipboardCacheEntry = { html: null };
  clipboardCache.set(markdown, entry);
  trimClipboardCache();
  void buildRichMarkdownClipboardHtml(
    markdown,
    renderMermaidAsPngDataUrl,
    () => waitForBrowserIdle(isCurrent),
  ).then(
    (html) => {
      if (isCurrent()) {
        entry.html = html;
      } else if (clipboardCache.get(markdown) === entry) {
        clipboardCache.delete(markdown);
      }
    },
    () => {
      if (clipboardCache.get(markdown) === entry) clipboardCache.delete(markdown);
    },
  );
}

function waitForBrowserIdle(isCurrent: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const wait = () => {
      if (!isCurrent()) {
        reject(new Error("Clipboard preparation cancelled"));
        return;
      }
      const quietFor = Date.now() - lastEditorScrollAt;
      if (quietFor < SCROLL_QUIET_MS) {
        window.setTimeout(wait, SCROLL_QUIET_MS - quietFor);
        return;
      }

      const finish = () => {
        if (!isCurrent()) {
          reject(new Error("Clipboard preparation cancelled"));
        } else if (Date.now() - lastEditorScrollAt < SCROLL_QUIET_MS) {
          wait();
        } else {
          resolve();
        }
      };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(finish);
      } else {
        window.setTimeout(finish, 0);
      }
    };
    wait();
  });
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
