import MarkdownIt from "markdown-it";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { svgContentAsPngDataUrl } from "../diagram/diagramExport";
import { renderMermaidSvg } from "../diagram/mermaidRenderer";
import { translateCurrent } from "../../shared/i18n/translate";

type MermaidImageRenderer = (source: string, index: number) => Promise<string>;
type BeforeMermaidRender = () => Promise<void>;
type CopyStatus = (message: string) => void;
type ClipboardResult = { html: string; failedDiagrams: number };
type CacheEntry = {
  result: ClipboardResult | null;
  promise: Promise<ClipboardResult>;
  urgent: boolean;
  isCurrent: () => boolean;
};
const MAX_CACHE_ENTRIES = 3;
const PREPARE_DELAY_MS = 250;
const SCROLL_QUIET_MS = 180;
const clipboardCache = new Map<string, CacheEntry>();
let lastEditorScrollAt = 0;
let renderSequence = 0;

function createMarkdownRenderer() {
  return new MarkdownIt({ html: false, linkify: true, typographer: true });
}

export function createRichMarkdownCopyExtension(onStatus?: CopyStatus) {
  return ViewPlugin.fromClass(class {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private revision = 0;
    private onScroll = () => { lastEditorScrollAt = Date.now(); };
    constructor(private view: EditorView) {
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      this.schedule();
    }
    update(update: ViewUpdate) { if (update.docChanged) this.schedule(); }
    destroy() {
      this.revision++;
      clearTimeout(this.timer);
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    }
    private schedule() {
      const revision = ++this.revision;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        prepareRichMarkdownClipboard(this.view.state.doc.toString(), () => this.revision === revision);
      }, PREPARE_DELAY_MS);
    }
  }, {
    eventHandlers: {
      copy(event, view) {
        return isEntireDocumentSelected(view)
          && copyRichMarkdownDocument(event, view.state.doc.toString(), onStatus);
      },
    },
  });
}

export async function buildRichMarkdownClipboardHtml(
  markdown: string,
  renderMermaidImage: MermaidImageRenderer = renderMermaidAsPngDataUrl,
  beforeMermaidRender: BeforeMermaidRender = async () => {},
): Promise<string> {
  return (await buildClipboard(markdown, renderMermaidImage, beforeMermaidRender)).html;
}

async function buildClipboard(markdown: string, renderImage: MermaidImageRenderer, beforeRender: BeforeMermaidRender): Promise<ClipboardResult> {
  const renderer = createMarkdownRenderer();
  const tokens = renderer.parse(markdown, {});
  const images = new Map<number, string>();
  let failedDiagrams = 0;
  let diagramIndex = 0;
  for (const [index, token] of tokens.entries()) {
    if (token.type !== "fence" || token.info.trim().split(/\s+/)[0].toLowerCase() !== "mermaid") continue;
    await beforeRender();
    try {
      const image = await renderImage(token.content, diagramIndex++);
      if (!image.startsWith("data:image/png;base64,")) throw new Error("Invalid diagram image");
      images.set(index, `<img alt="${renderer.utils.escapeHtml(translateCurrent("diagram.mermaid"))}" src="${renderer.utils.escapeHtml(image)}" style="display:block;max-width:100%;height:auto;" />`);
    } catch {
      failedDiagrams++;
    }
  }
  const defaultFence = renderer.renderer.rules.fence!;
  renderer.renderer.rules.fence = (items, index, options, env, self) =>
    images.get(index) ?? defaultFence(items, index, options, env, self);
  const html = renderer.renderer.render(tokens, renderer.options, {});
  return { html: `<!doctype html><html><body><article data-polarbear-clipboard="rich-markdown">${html}</article></body></html>`, failedDiagrams };
}

export function isEntireDocumentSelected(view: EditorView): boolean {
  const selection = view.state.selection;
  return selection.ranges.length === 1 && view.state.doc.length > 0
    && selection.main.from === 0 && selection.main.to === view.state.doc.length;
}

export function isEntirePreviewSelected(surface: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return false;
  const contents = document.createRange();
  contents.selectNodeContents(surface);
  const range = selection.getRangeAt(0);
  return range.compareBoundaryPoints(Range.START_TO_START, contents) <= 0
    && range.compareBoundaryPoints(Range.END_TO_END, contents) >= 0;
}

export function copyRichMarkdownDocument(event: ClipboardEvent, markdown: string, onStatus?: CopyStatus): boolean {
  if (event.defaultPrevented || !event.clipboardData || !containsMermaid(markdown)) return false;
  const entry = preparedDocument(markdown, true);
  try { event.clipboardData.setData("text/plain", markdown); } catch { return false; }
  try { event.clipboardData.setData("text/markdown", markdown); } catch { /* Optional MIME type. */ }
  event.preventDefault();
  if (entry.result) {
    try {
      event.clipboardData.setData("text/html", entry.result.html);
      reportResult(entry.result, onStatus);
    } catch { onStatus?.(translateCurrent("clipboard.richCopyFailed")); }
    return true;
  }
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    onStatus?.(translateCurrent("clipboard.richNotReady"));
    return true;
  }
  // Start inside the copy gesture: WebKit requires activation before rendering
  // completes. ClipboardItem accepts promises for the eventual MIME payloads.
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  document.addEventListener("copy", cancel, true);
  const html = entry.promise.then((result) => {
    if (cancelled) throw new DOMException("Superseded copy", "AbortError");
    return new Blob([result.html], { type: "text/html" });
  });
  void html.catch(() => {}); // A denied write may never consume the payload.
  onStatus?.(translateCurrent("clipboard.preparing"));
  try {
    const write = navigator.clipboard.write([new ClipboardItem({
      "text/plain": new Blob([markdown], { type: "text/plain" }), "text/html": html,
    })]);
    void write.then(() => {
      if (!cancelled && entry.result) reportResult(entry.result, onStatus);
    }, () => {
      if (!cancelled) onStatus?.(translateCurrent("clipboard.richCopyFailed"));
    }).finally(() => document.removeEventListener("copy", cancel, true));
  } catch {
    document.removeEventListener("copy", cancel, true);
    onStatus?.(translateCurrent("clipboard.richCopyFailed"));
  }
  return true;
}

function reportResult(result: ClipboardResult, onStatus?: CopyStatus) {
  onStatus?.(translateCurrent(result.failedDiagrams ? "clipboard.partialDiagrams" : "clipboard.richCopied",
    { count: result.failedDiagrams }));
}

export function prepareRichMarkdownClipboard(markdown: string, isCurrent = () => true): void {
  if (containsMermaid(markdown)) preparedDocument(markdown, false, isCurrent);
}

function preparedDocument(markdown: string, urgent: boolean, isCurrent = () => true): CacheEntry {
  const existing = clipboardCache.get(markdown);
  if (existing) {
    if (urgent) { existing.urgent = true; existing.isCurrent = () => true; }
    return existing;
  }
  const entry: CacheEntry = { result: null, urgent, isCurrent, promise: Promise.resolve({ html: "", failedDiagrams: 0 }) };
  entry.promise = buildClipboard(markdown, renderMermaidAsPngDataUrl, () => waitForBrowserIdle(entry))
    .then((result) => {
      entry.result = result;
      // Keep source on failure, but retry transient rendering failures next time.
      if (result.failedDiagrams && clipboardCache.get(markdown) === entry) clipboardCache.delete(markdown);
      return result;
    });
  void entry.promise.catch(() => {
    if (clipboardCache.get(markdown) === entry) clipboardCache.delete(markdown);
  });
  clipboardCache.set(markdown, entry);
  while (clipboardCache.size > MAX_CACHE_ENTRIES) clipboardCache.delete(clipboardCache.keys().next().value!);
  return entry;
}

function waitForBrowserIdle(entry: CacheEntry): Promise<void> {
  if (entry.urgent) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const wait = () => {
      if (!entry.isCurrent()) { reject(new Error("Clipboard preparation cancelled")); return; }
      if (entry.urgent) { resolve(); return; }
      const quietFor = Date.now() - lastEditorScrollAt;
      if (quietFor < SCROLL_QUIET_MS) { setTimeout(wait, SCROLL_QUIET_MS - quietFor); return; }
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => entry.isCurrent() ? resolve() : reject(new Error("Clipboard preparation cancelled")), { timeout: 500 });
      } else { setTimeout(resolve, 0); }
    };
    wait();
  });
}

function containsMermaid(markdown: string): boolean {
  return createMarkdownRenderer().parse(markdown, {}).some((token) =>
    token.type === "fence" && token.info.trim().split(/\s+/)[0].toLowerCase() === "mermaid");
}

async function renderMermaidAsPngDataUrl(source: string, index: number): Promise<string> {
  const svg = await renderMermaidSvg(`polarbear-clipboard-${++renderSequence}-${index}`, source);
  return svgContentAsPngDataUrl(svg);
}
