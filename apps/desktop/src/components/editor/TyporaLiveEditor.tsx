import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { redo, selectAll, undo } from "@codemirror/commands";
import { search } from "@codemirror/search";
import {
  EditorSelection,
  EditorState,
  Prec,
  StateField,
  type Range,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  keymap,
} from "@codemirror/view";
import mermaid from "mermaid";
import { resolveMarkdownAsset } from "../../tauri/workspaceCommands";
import {
  exportSvgElementAsPng,
  exportSvgElementAsSvg,
  findRenderedSvg,
} from "../diagrams/diagramExport";
import { mermaidDiagramConfig } from "../diagrams/mermaidDiagramConfig";
import { macNavigationKeyBindings } from "./macNavigationKeymap";
import type { MarkdownEditorView } from "./MarkdownEditor";
import {
  escapeMarkdownTableCell,
  insertLineBreakAtCurrentSelection,
  markdownFromTableCellElement,
  placeCaretAtEnd,
  renderTableCellValue,
} from "./live/tableCellMarkdown";

type ImagePasteHandler = (
  items: DataTransferItemList,
  insertMarkdown?: (markdown: string) => void,
) => void;

type ImageDropHandler = (filePaths: string[]) => void;

type DroppedFile = File & {
  path?: string;
};

type TyporaLiveEditorProps = {
  activeFileId: string;
  markdown?: string;
  markdownContent?: string;
  onChange?: (nextMarkdown: string) => void;
  onMarkdownChange?: (nextMarkdown: string) => void;
  onEditorReady?: (editorView: MarkdownEditorView | null) => void;
  onImageDrop?: ImageDropHandler;
  onImagePaste?: ImagePasteHandler;
  workspaceRoot: string;
};

type CodeFenceInfo = {
  lineFrom: number;
  lineTo: number;
  markerTo: number;
  languageFrom: number;
  languageTo: number;
  language: string;
};

type TyporaDecorationRange = Range<Decoration>;

type PreviewBlock = {
  from: number;
  id: string;
  to: number;
  language?: string;
  raw: string;
  source: string;
  type:
    | "blockquoteCallout"
    | "htmlImage"
    | "hr"
    | "image"
    | "math"
    | "mermaid"
    | "plantuml"
    | "table";
};

function makePreviewBlock(block: Omit<PreviewBlock, "id">): PreviewBlock {
  return {
    ...block,
    id: `${block.type}:${block.from}:${block.to}:${hashPreviewBlockSource(block.source || block.raw)}`,
  };
}

function hashPreviewBlockSource(source: string): string {
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function markMarkdownPreviewBlock(
  element: HTMLElement,
  block: Pick<PreviewBlock, "id" | "type"> & Partial<Pick<PreviewBlock, "from" | "to">>,
  className?: string,
) {
  element.dataset.markdownBlockId = block.id;
  element.dataset.markdownBlockType = block.type;
  if (typeof block.from === "number") {
    element.dataset.markdownBlockFrom = String(block.from);
  }
  if (typeof block.to === "number") {
    element.dataset.markdownBlockTo = String(block.to);
  }
  if (className) {
    element.classList.add(className);
  }
}

type TableAlignment = "center" | "default" | "left" | "right";

function clearLiveScrollAreaSizing(pane: HTMLElement) {
  pane.style.height = "";
  pane.style.maxHeight = "";
  pane.style.minHeight = "";
  pane.style.overflow = "";
  pane.style.display = "";
  pane.style.flexDirection = "";
  delete pane.dataset.liveViewportHeight;

  for (const selector of [".cm-theme", ".cm-editor", ".cm-scroller"]) {
    const element = pane.querySelector(selector);
    if (element instanceof HTMLElement) {
      element.style.minHeight = "";
      element.style.height = "";
      element.style.maxHeight = "";
      element.style.overflow = "";
      element.style.overflowX = "";
      element.style.overflowY = "";
      element.style.overscrollBehavior = "";
    }
  }
}

function sizeLiveCodeMirrorViewport(pane: HTMLElement): boolean {
  const title = pane.querySelector(".typora-live-title");
  const theme = pane.querySelector(".cm-theme");
  const editor = pane.querySelector(".cm-editor");
  const scroller = pane.querySelector(".cm-scroller");

  if (!(editor instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
    return false;
  }

  // Use layout dimensions here, not getBoundingClientRect().
  // The live editor can sit inside the app-level zoom canvas, whose transform
  // changes the visual rect during pinch/zoom. Feeding that transformed rect
  // back into CodeMirror's real scroller height makes the right pane relayout
  // while the whole app is being visually scaled.
  const paneHeight = pane.clientHeight;
  const titleHeight = title instanceof HTMLElement
    ? title.offsetHeight
    : 0;
  const viewportHeight = Math.max(
    240,
    Math.floor(paneHeight - titleHeight),
  );

  const sizedElements = theme instanceof HTMLElement
    ? [theme, editor, scroller]
    : [editor, scroller];
  const viewportHeightValue = `${viewportHeight}px`;

  for (const element of sizedElements) {
    if (element.style.minHeight !== "0") {
      element.style.minHeight = "0";
    }
    if (element.style.height !== viewportHeightValue) {
      element.style.height = viewportHeightValue;
    }
    if (element.style.maxHeight !== viewportHeightValue) {
      element.style.maxHeight = viewportHeightValue;
    }
  }

  if (theme instanceof HTMLElement) {
    if (theme.style.overflow !== "hidden") {
      theme.style.overflow = "hidden";
    }
  }
  if (editor.style.overflow !== "hidden") {
    editor.style.overflow = "hidden";
  }
  if (scroller.style.overflowX !== "auto") {
    scroller.style.overflowX = "auto";
  }
  if (scroller.style.overflowY !== "auto") {
    scroller.style.overflowY = "auto";
  }
  if (scroller.style.overscrollBehavior !== "contain") {
    scroller.style.overscrollBehavior = "contain";
  }
  pane.dataset.liveViewportHeight = String(viewportHeight);

  return true;
}

function isAppCanvasZooming(): boolean {
  return document.documentElement.dataset.appCanvasZooming === "true";
}

function getAppCanvasZoom(): number {
  const value = Number.parseFloat(document.documentElement.dataset.appCanvasZoom ?? "1");
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function isAppCanvasTransformActive(): boolean {
  return isAppCanvasZooming() || Math.abs(getAppCanvasZoom() - 1) > 0.0005;
}

function isLiveDebugEnabled(): boolean {
  try {
    return window.localStorage.getItem("polarbear.liveDebug") === "1";
  } catch {
    return false;
  }
}

function isLiveDebugPanelEnabled(): boolean {
  try {
    return window.localStorage.getItem("polarbear.liveDebugPanel") === "1";
  } catch {
    return false;
  }
}

function isLiveScrollDebugEnabled(): boolean {
  try {
    return window.localStorage.getItem("polarbear.liveDebugScroll") === "1";
  } catch {
    return false;
  }
}

function writeLiveDebugOverlay(text: string): void {
  const overlayId = "polarbear-live-debug-overlay";
  let overlay = document.getElementById(overlayId) as HTMLDivElement | null;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.dataset.polarbearDebugOverlay = "true";
    overlay.style.position = "fixed";
    overlay.style.left = "12px";
    overlay.style.bottom = "12px";
    overlay.style.zIndex = "2147483646";
    overlay.style.maxWidth = "760px";
    overlay.style.maxHeight = "38vh";
    overlay.style.margin = "0";
    overlay.style.padding = "10px 12px";
    overlay.style.overflow = "auto";
    overlay.style.border = "1px solid rgba(148, 163, 184, 0.45)";
    overlay.style.borderRadius = "8px";
    overlay.style.background = "rgba(15, 23, 42, 0.88)";
    overlay.style.color = "#e5edf8";
    overlay.style.font = "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace";
    overlay.style.pointerEvents = "none";
    overlay.style.whiteSpace = "pre-wrap";

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.debugCopy = "true";
    button.textContent = "Copy";
    button.style.float = "right";
    button.style.margin = "0 0 8px 12px";
    button.style.pointerEvents = "auto";
    button.style.cursor = "pointer";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const debugText = overlay?.querySelector("pre")?.textContent ?? "";
      void copyDebugText(debugText);
    });

    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.font = "inherit";
    overlay.append(button, pre);
    document.body.appendChild(overlay);
  }

  const pre = overlay.querySelector("pre");
  if (pre) {
    pre.textContent = text;
  }
}

async function copyDebugText(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Debug copy is best-effort and must not crash the editor.
  }
}

type LiveDebugState = {
  version: string;
  source: string;
  eventCount: number;
  zoom: number;
  cssZoom: string;
  appCanvasZooming: string;
  paneHeight: number;
  themeHeight: number;
  editorHeight: number;
  contentFontSize: string;
  contentPaddingTop: string;
  contentWidth: number;
  contentHeight: number;
  contentClientWidth: number;
  contentScrollWidth: number;
  contentScrollHeight: number;
  scrollerClientWidth: number;
  scrollerScrollWidth: number;
  scrollerClientHeight: number;
  scrollerScrollHeight: number;
  scrollTop: number;
  maxScrollTop: number;
  editorContentHeight: number;
  viewportFrom: number;
  viewportTo: number;
  docLength: number;
  docLines: number;
  key: string;
  beforeSelection: string;
  afterSelection: string;
  wheel: string;
  mouse: string;
  mousePos: string;
  target: string;
  pinch: string;
  note: string;
};

function createInitialLiveDebugState(): LiveDebugState {
  return {
    version: "v8-debug",
    source: "init",
    eventCount: 0,
    zoom: 1,
    cssZoom: "",
    appCanvasZooming: "",
    paneHeight: 0,
    themeHeight: 0,
    editorHeight: 0,
    contentFontSize: "",
    contentPaddingTop: "",
    contentWidth: 0,
    contentHeight: 0,
    contentClientWidth: 0,
    contentScrollWidth: 0,
    contentScrollHeight: 0,
    scrollerClientWidth: 0,
    scrollerScrollWidth: 0,
    scrollerClientHeight: 0,
    scrollerScrollHeight: 0,
    scrollTop: 0,
    maxScrollTop: 0,
    editorContentHeight: 0,
    viewportFrom: 0,
    viewportTo: 0,
    docLength: 0,
    docLines: 0,
    key: "",
    beforeSelection: "",
    afterSelection: "",
    wheel: "",
    mouse: "",
    mousePos: "",
    target: "",
    pinch: "",
    note: "",
  };
}

function describeSelection(view: EditorView | null): string {
  if (!view) {
    return "no-view";
  }

  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return `line=${line.number} col=${head - line.from + 1} pos=${head}`;
}

function collectLiveDebugState(
  pane: HTMLElement | null,
  view: EditorView | null,
  zoom: number,
  previous: LiveDebugState,
  source: string,
  extra: Partial<LiveDebugState> = {},
): LiveDebugState {
  const scroller = pane?.querySelector(".cm-scroller");
  const content = pane?.querySelector(".cm-content");
  const theme = pane?.querySelector(".cm-theme");
  const editor = pane?.querySelector(".cm-editor");
  const scrollerElement = scroller instanceof HTMLElement ? scroller : null;
  const contentElement = content instanceof HTMLElement ? content : null;
  const themeElement = theme instanceof HTMLElement ? theme : null;
  const editorElement = editor instanceof HTMLElement ? editor : null;
  const computedContent = contentElement ? window.getComputedStyle(contentElement) : null;
  const paneRect = pane?.getBoundingClientRect();
  const themeRect = themeElement?.getBoundingClientRect();
  const editorRect = editorElement?.getBoundingClientRect();
  const contentRect = contentElement?.getBoundingClientRect();

  return {
    ...previous,
    version: "v8-debug",
    source,
    eventCount: previous.eventCount + 1,
    note: "",
    zoom,
    cssZoom: zoom.toFixed(3),
    appCanvasZooming: document.documentElement.dataset.appCanvasZooming ?? "false",
    paneHeight: paneRect ? Math.round(paneRect.height) : 0,
    themeHeight: themeRect ? Math.round(themeRect.height) : 0,
    editorHeight: editorRect ? Math.round(editorRect.height) : 0,
    contentFontSize: computedContent?.fontSize ?? "",
    contentPaddingTop: computedContent?.paddingTop ?? "",
    contentWidth: contentRect ? Math.round(contentRect.width) : 0,
    contentHeight: contentRect ? Math.round(contentRect.height) : 0,
    contentClientWidth: contentElement?.clientWidth ?? 0,
    contentScrollWidth: contentElement?.scrollWidth ?? 0,
    contentScrollHeight: contentElement?.scrollHeight ?? 0,
    scrollerClientWidth: scrollerElement?.clientWidth ?? 0,
    scrollerScrollWidth: scrollerElement?.scrollWidth ?? 0,
    scrollerClientHeight: scrollerElement?.clientHeight ?? 0,
    scrollerScrollHeight: scrollerElement?.scrollHeight ?? 0,
    scrollTop: scrollerElement?.scrollTop ?? 0,
    maxScrollTop: scrollerElement
      ? Math.max(0, scrollerElement.scrollHeight - scrollerElement.clientHeight)
      : 0,
    editorContentHeight: view ? Math.round(view.contentHeight) : 0,
    viewportFrom: view?.viewport.from ?? 0,
    viewportTo: view?.viewport.to ?? 0,
    docLength: view?.state.doc.length ?? 0,
    docLines: view?.state.doc.lines ?? 0,
    afterSelection: describeSelection(view),
    ...extra,
  };
}

function describeDebugTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) {
    return "unknown";
  }

  const tag = target.tagName.toLowerCase();
  const className = typeof target.className === "string"
    ? target.className.trim().replace(/\s+/g, ".")
    : "";

  return className ? `${tag}.${className}` : tag;
}

function formatLiveDebugState(debugState: LiveDebugState): string {
  return [
    `LIVE DEBUG ${debugState.version} source=${debugState.source} events=${debugState.eventCount}`,
    `pane/theme/editor height=${debugState.paneHeight}/${debugState.themeHeight}/${debugState.editorHeight}`,
    `scroller client/scroll height=${debugState.scrollerClientHeight}/${debugState.scrollerScrollHeight} scrollTop=${debugState.scrollTop} max=${debugState.maxScrollTop}`,
    `scroller client/scroll width=${debugState.scrollerClientWidth}/${debugState.scrollerScrollWidth}`,
    `content rect/client/scroll height=${debugState.contentHeight}/${debugState.contentScrollHeight} width=${debugState.contentWidth}/${debugState.contentClientWidth}/${debugState.contentScrollWidth}`,
    `cm contentHeight=${debugState.editorContentHeight} viewport=${debugState.viewportFrom}-${debugState.viewportTo} doc=${debugState.docLines} lines/${debugState.docLength} chars`,
    `selection before=${debugState.beforeSelection || "n/a"} after=${debugState.afterSelection || "n/a"}`,
    `wheel=${debugState.wheel || "n/a"} mouse=${debugState.mouse || "n/a"} target=${debugState.target || "n/a"}`,
    `appZoom=${debugState.pinch || "n/a"}`,
    `appCanvasZooming=${debugState.appCanvasZooming || "false"} appCanvasZoom=${getAppCanvasZoom().toFixed(3)}`,
    `zoom=${Math.round(debugState.zoom * 100)}% css=${debugState.cssZoom || "n/a"} font=${debugState.contentFontSize || "n/a"} paddingTop=${debugState.contentPaddingTop || "n/a"}`,
    `note=${debugState.note || "n/a"}`,
  ].join("\n");
}

const headingLineDecorations = Array.from({ length: 6 }, (_, index) =>
  Decoration.line({
    attributes: {
      class: `cm-typora-heading-line cm-typora-heading-${index + 1}`,
    },
  }),
);

const hiddenMarkdownMarkerDecoration = Decoration.replace({});

const boldDecoration = Decoration.mark({
  class: "cm-typora-bold",
});

const italicDecoration = Decoration.mark({
  class: "cm-typora-italic",
});

const underlineDecoration = Decoration.mark({
  class: "cm-typora-underline",
});

const strikeDecoration = Decoration.mark({
  class: "cm-typora-strike",
});

const inlineCodeDecoration = Decoration.mark({
  class: "cm-typora-inline-code",
});

const markDecoration = Decoration.mark({
  class: "cm-typora-mark",
});

const linkDecoration = Decoration.mark({
  class: "cm-typora-link",
});

const kbdDecoration = Decoration.mark({
  class: "cm-typora-kbd",
});

const horizontalRuleDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-horizontal-rule-line",
  },
});

const frontmatterLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-frontmatter-line",
  },
});

const frontmatterDelimiterLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-frontmatter-line cm-typora-frontmatter-delimiter-line",
  },
});

const blockquoteLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-blockquote-line",
  },
});

const unorderedListLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-list-line cm-typora-unordered-list-line",
  },
});

const orderedListLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-list-line cm-typora-ordered-list-line",
  },
});

const taskListLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-list-line cm-typora-task-list-line",
  },
});

const tableLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-table-line",
  },
});

const collapsedMarkdownMarkerDecoration = Decoration.mark({
  class: "cm-typora-markdown-marker-hidden",
});

const collapsedHeadingMarkerDecoration = Decoration.replace({});

const hiddenCodeFenceLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-code-fence-line-hidden",
  },
});

const imageLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-image-line",
  },
});

type CodeLineEdge = "first" | "last" | "middle" | "single";

const codeLineDecorationCache = new Map<string, Decoration>();

const codeTokenDecorations = {
  attr: Decoration.mark({ class: "cm-typora-code-token-attr" }),
  boolean: Decoration.mark({ class: "cm-typora-code-token-boolean" }),
  comment: Decoration.mark({ class: "cm-typora-code-token-comment" }),
  keyword: Decoration.mark({ class: "cm-typora-code-token-keyword" }),
  number: Decoration.mark({ class: "cm-typora-code-token-number" }),
  property: Decoration.mark({ class: "cm-typora-code-token-property" }),
  string: Decoration.mark({ class: "cm-typora-code-token-string" }),
  tag: Decoration.mark({ class: "cm-typora-code-token-tag" }),
};

function normalizeCodeLanguage(language: string | undefined): string {
  const normalized = (language ?? "text").trim().toLowerCase();
  if (!normalized) {
    return "text";
  }

  if (normalized === "js") {
    return "javascript";
  }

  if (normalized === "ts") {
    return "typescript";
  }

  if (normalized === "sh") {
    return "bash";
  }

  if (normalized === "yml") {
    return "yaml";
  }

  if (normalized === "puml" || normalized === "uml") {
    return "plantuml";
  }

  return normalized.replace(/[^a-z0-9_-]/g, "-");
}

function codeLineDecorationForLanguage(
  language: string,
  edge: CodeLineEdge,
): Decoration {
  const normalized = normalizeCodeLanguage(language);
  const cacheKey = `${normalized}:${edge}`;
  const cached = codeLineDecorationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const decoration = Decoration.line({
    attributes: {
      class: `cm-typora-code-line cm-typora-code-line-${normalized} cm-typora-code-line-${edge}`,
    },
  });
  codeLineDecorationCache.set(cacheKey, decoration);
  return decoration;
}

const supportedCodeLanguages = [
  "text",
  "markdown",
  "json",
  "java",
  "yaml",
  "typescript",
  "tsx",
  "javascript",
  "sql",
  "rust",
  "bash",
  "shell",
  "xml",
  "html",
  "css",
  "python",
  "go",
  "kotlin",
  "properties",
  "mermaid",
  "plantuml",
];

const mermaidRenderCache = new Map<
  string,
  { error?: string; svgContent?: string }
>();
const plantUmlRenderCache = new Map<
  string,
  { error?: string; svgContent?: string }
>();

const plantUmlServerUrl = "https://www.plantuml.com/plantuml/svg/";

let mermaidInitialized = false;

export function TyporaLiveEditor({
  activeFileId,
  markdown,
  markdownContent,
  onChange,
  onMarkdownChange,
  onEditorReady,
  onImageDrop,
  onImagePaste,
  workspaceRoot,
}: TyporaLiveEditorProps) {
  const editorMarkdown = markdown ?? markdownContent ?? "";
  const emitChange = onChange ?? onMarkdownChange ?? (() => undefined);
  const paneRef = useRef<HTMLElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const onEditorReadyRef = useRef(onEditorReady);
  const onImagePasteRef = useRef(onImagePaste);
  const [debugRevision, setDebugRevision] = useState(0);
  const liveDebugEnabled = useMemo(() => isLiveDebugEnabled(), [debugRevision]);
  const liveDebugPanelEnabled = useMemo(() => isLiveDebugPanelEnabled(), [debugRevision]);
  const [debugState, setDebugState] = useState<LiveDebugState>(() => createInitialLiveDebugState());

  useEffect(() => {
    const handleDebugChange = () => setDebugRevision((revision) => revision + 1);
    window.addEventListener("polarbear-debug-changed", handleDebugChange);
    return () => window.removeEventListener("polarbear-debug-changed", handleDebugChange);
  }, []);

  useEffect(() => {
    if (!liveDebugEnabled) {
      document.getElementById("polarbear-live-debug-overlay")?.remove();
    }
  }, [liveDebugEnabled]);

  useEffect(() => {
    onEditorReadyRef.current = onEditorReady;
  }, [onEditorReady]);

  useEffect(() => {
    onImagePasteRef.current = onImagePaste;
  }, [onImagePaste]);

  const stableImagePasteHandler = useCallback<ImagePasteHandler>((items, insertMarkdown) => {
    onImagePasteRef.current?.(items, insertMarkdown);
  }, []);

  const reportLiveDebug = useCallback((source: string, extra: Partial<LiveDebugState> = {}) => {
    if (!liveDebugEnabled) {
      return;
    }

    const pane = paneRef.current;
    const view = editorViewRef.current;
    const nextState = collectLiveDebugState(
      pane,
      view,
      debugState.zoom,
      debugState,
      source,
      extra,
    );
    writeLiveDebugOverlay(formatLiveDebugState(nextState));
    if (liveDebugPanelEnabled && !isAppCanvasTransformActive()) {
      setDebugState(nextState);
    }
  }, [debugState, liveDebugEnabled, liveDebugPanelEnabled]);

  const editorExtensions = useMemo(
    () => [
      typoraLiveKeymap(),
      trimSingleLineBreakSelectionExtension,
      preserveLargeEnterScrollJumpExtension,
      markdownLanguage(),
      search({ top: true }),
      linkClickExtension(),
      imagePasteExtension(stableImagePasteHandler),
      typoraLiveDecorations({
        activeFileId,
        workspaceRoot,
      }),
      EditorView.lineWrapping,
    ],
    [activeFileId, stableImagePasteHandler, workspaceRoot],
  );

  useEffect(() => {
    if (!liveDebugEnabled || !isLiveScrollDebugEnabled()) {
      return undefined;
    }

    const pane = paneRef.current;
    if (!pane) {
      return undefined;
    }

    let activeLanguageWidget: HTMLElement | null = null;

    const setActiveLanguageWidget = (nextWidget: HTMLElement | null) => {
      if (activeLanguageWidget === nextWidget) {
        return;
      }

      activeLanguageWidget?.classList.remove("cm-typora-code-language-visible");
      activeLanguageWidget = nextWidget;
      activeLanguageWidget?.classList.add("cm-typora-code-language-visible");
    };

    const findLanguageWidgetForCodeLine = (line: Element): HTMLElement | null => {
      let sibling = line.previousElementSibling;

      while (sibling) {
        if (
          sibling instanceof HTMLElement &&
          sibling.classList.contains("cm-typora-code-language")
        ) {
          return sibling;
        }

        if (
          sibling.classList.contains("cm-line") &&
          sibling.classList.contains("cm-typora-code-line")
        ) {
          sibling = sibling.previousElementSibling;
          continue;
        }

        return null;
      }

      return null;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setActiveLanguageWidget(null);
        return;
      }

      const languageWidget = target.closest(".cm-typora-code-language");
      if (languageWidget instanceof HTMLElement) {
        setActiveLanguageWidget(languageWidget);
        return;
      }

      const codeLine = target.closest(".cm-line.cm-typora-code-line");
      if (codeLine) {
        setActiveLanguageWidget(findLanguageWidgetForCodeLine(codeLine));
        return;
      }

      setActiveLanguageWidget(null);
    };

    const handlePointerLeave = () => {
      setActiveLanguageWidget(null);
    };

    pane.addEventListener("pointermove", handlePointerMove);
    pane.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      pane.removeEventListener("pointermove", handlePointerMove);
      pane.removeEventListener("pointerleave", handlePointerLeave);
      activeLanguageWidget?.classList.remove("cm-typora-code-language-visible");
    };
  }, []);

  useEffect(() => {
    return () => {
      editorViewRef.current = null;
      onEditorReadyRef.current?.(null);
    };
  }, []);


  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) {
      return undefined;
    }

    let frameId = 0;

    const syncLiveScrollArea = () => {
      if (isAppCanvasTransformActive()) {
        return;
      }

      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        if (isAppCanvasTransformActive()) {
          return;
        }

        const beforeViewportHeight = pane.dataset.liveViewportHeight ?? "";
        const didSize = sizeLiveCodeMirrorViewport(pane);
        const didViewportHeightChange =
          didSize && (pane.dataset.liveViewportHeight ?? "") !== beforeViewportHeight;
        if (didViewportHeightChange) {
          editorViewRef.current?.requestMeasure();
        }
        reportLiveDebug(didSize ? "height-sync-sized" : "height-sync-missing-cm", {
          note: didSize
            ? didViewportHeightChange
              ? "Sized .cm-theme/.cm-editor/.cm-scroller from pane height"
              : "Live viewport height unchanged"
            : "CodeMirror DOM not ready",
        });

        if (!didSize) {
          window.requestAnimationFrame(() => {
            if (isAppCanvasTransformActive()) {
              return;
            }

            const beforeRetryViewportHeight = pane.dataset.liveViewportHeight ?? "";
            const didRetrySize = sizeLiveCodeMirrorViewport(pane);
            const didRetryViewportHeightChange =
              didRetrySize &&
              (pane.dataset.liveViewportHeight ?? "") !== beforeRetryViewportHeight;
            if (didRetryViewportHeightChange) {
              editorViewRef.current?.requestMeasure();
            }
            reportLiveDebug(didRetrySize ? "height-sync-sized-raf" : "height-sync-missing-cm-raf", {
              note: didRetrySize
                ? didRetryViewportHeightChange
                  ? "Sized after RAF"
                  : "Live viewport height unchanged after RAF"
                : "CodeMirror DOM still missing after RAF",
            });
          });
        }
      });
    };

    syncLiveScrollArea();
    window.addEventListener("polarbear-app-canvas-zoom-settled", syncLiveScrollArea);
    window.addEventListener("resize", syncLiveScrollArea);
    window.visualViewport?.addEventListener("resize", syncLiveScrollArea);
    const resizeObserver = new ResizeObserver(syncLiveScrollArea);
    resizeObserver.observe(pane);
    if (pane.parentElement) {
      resizeObserver.observe(pane.parentElement);
    }

    const mutationObserver = new MutationObserver(syncLiveScrollArea);
    mutationObserver.observe(pane, {
      childList: true,
      subtree: false,
    });

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("polarbear-app-canvas-zoom-settled", syncLiveScrollArea);
      window.removeEventListener("resize", syncLiveScrollArea);
      window.visualViewport?.removeEventListener("resize", syncLiveScrollArea);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      clearLiveScrollAreaSizing(pane);
    };
  }, [liveDebugEnabled, reportLiveDebug]);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) {
      return undefined;
    }

    let animationFrame = 0;
    let pendingSource = "scroll-debug";
    let pendingExtra: Partial<LiveDebugState> = {};

    const flushDebug = () => {
      animationFrame = 0;
      reportLiveDebug(pendingSource, pendingExtra);
      pendingExtra = {};
    };

    const scheduleDebug = (
      source: string,
      extra: Partial<LiveDebugState> = {},
    ) => {
      pendingSource = source;
      pendingExtra = {
        ...pendingExtra,
        ...extra,
      };

      if (animationFrame) {
        return;
      }

      animationFrame = window.requestAnimationFrame(flushDebug);
    };

    const onWheel = (event: WheelEvent) => {
      scheduleDebug("wheel", {
        target: describeDebugTarget(event.target),
        wheel: `dx=${Math.round(event.deltaX)} dy=${Math.round(event.deltaY)} mode=${event.deltaMode} meta=${event.metaKey ? 1 : 0} ctrl=${event.ctrlKey ? 1 : 0}`,
      });
    };

    const onScroll = (event: Event) => {
      scheduleDebug("scroll", {
        target: describeDebugTarget(event.target),
      });
    };

    const attach = () => {
      const scroller = pane.querySelector(".cm-scroller");
      if (!(scroller instanceof HTMLElement)) {
        scheduleDebug("scroll-debug-no-scroller", {
          note: "No .cm-scroller found yet",
        });
        return null;
      }

      scroller.addEventListener("wheel", onWheel, {
        passive: true,
      });
      scroller.addEventListener("scroll", onScroll, {
        passive: true,
      });
      scheduleDebug("scroll-debug-attached");

      return scroller;
    };

    let scroller = attach();
    const retryTimer = window.setTimeout(() => {
      if (!scroller) {
        scroller = attach();
      }
    }, 120);

    return () => {
      window.clearTimeout(retryTimer);
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      scroller?.removeEventListener("wheel", onWheel);
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, [reportLiveDebug]);

  return (
    <section
      ref={paneRef}
      className="editor-pane typora-live-editor-pane"
      data-editor-document-host="true"
      data-editor-document-mode="live"
      onDragOver={(event) => {
        if (onImageDrop) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => (file as DroppedFile).path ?? "")
          .filter(Boolean);

        if (paths.length > 0 && onImageDrop) {
          event.preventDefault();
          onImageDrop(paths);
        }
      }}
    >
      {liveDebugEnabled && liveDebugPanelEnabled ? (
        <div className="typora-live-debug-panel">
          <div className="typora-live-debug-header">
            <strong>Scroll Debug</strong>
            <button
              type="button"
              onClick={() => {
                void copyDebugText(formatLiveDebugState(debugState));
              }}
            >
              Copy
            </button>
          </div>
          <pre>{formatLiveDebugState(debugState)}</pre>
        </div>
      ) : null}
      <CodeMirror
        value={editorMarkdown}
        extensions={editorExtensions}
        onCreateEditor={(view) => {
          editorViewRef.current = view;
          if (paneRef.current) {
            sizeLiveCodeMirrorViewport(paneRef.current);
            view.requestMeasure();
            reportLiveDebug("editor-created-sized", {
              note: "Sized CodeMirror viewport after editor creation",
            });
          }
          onEditorReadyRef.current?.(view as MarkdownEditorView);
        }}
        onChange={(nextMarkdown) => emitChange(nextMarkdown)}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
        }}
      />
    </section>
  );
}

function typoraLiveKeymap() {
  return Prec.highest(keymap.of([
    ...macNavigationKeyBindings(),
    {
      key: "Mod-Enter",
      preventDefault: true,
      run: exitFenceBlock,
    },
    {
      key: "Enter",
      run: handleCodeFenceEnter,
    },
    {
      key: "Mod-b",
      run: (view) => toggleSelectionWrapper(view, "**", "**", "bold"),
    },
    {
      key: "Mod-i",
      run: (view) => toggleSelectionWrapper(view, "*", "*", "italic"),
    },
    {
      key: "Mod-u",
      run: (view) => toggleSelectionWrapper(view, "<u>", "</u>", "underline"),
    },
    {
      key: "Mod-k",
      run: wrapLinkSelection,
    },
    {
      key: "Mod-Shift-k",
      run: (view) => insertBlockInEditor(view, "```text\n", "\n```\n", ""),
    },
    {
      key: "Mod-Shift-m",
      run: (view) => insertBlockInEditor(view, "$$\n", "\n$$\n", ""),
    },
    {
      key: "Mod-1",
      run: (view) => setCurrentLineHeading(view, 1),
    },
    {
      key: "Mod-2",
      run: (view) => setCurrentLineHeading(view, 2),
    },
    {
      key: "Mod-3",
      run: (view) => setCurrentLineHeading(view, 3),
    },
    {
      key: "Mod-4",
      run: (view) => setCurrentLineHeading(view, 4),
    },
    {
      key: "Mod-5",
      run: (view) => setCurrentLineHeading(view, 5),
    },
    {
      key: "Mod-6",
      run: (view) => setCurrentLineHeading(view, 6),
    },
    {
      key: "Mod-a",
      run: selectAll,
    },
    {
      key: "Mod-z",
      run: undo,
    },
    {
      key: "Mod-y",
      run: redo,
    },
    {
      key: "Mod-Shift-z",
      run: redo,
    },
  ]));
}

const trimSingleLineBreakSelectionExtension = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.selection || transaction.docChanged) {
    return transaction;
  }

  const selection = transaction.newSelection;
  let changed = false;

  const ranges = selection.ranges.map((range) => {
    const trimmed = trimSingleLineBreakSelection(
      transaction.newDoc,
      range.anchor,
      range.head,
    );

    if (!trimmed) {
      return range;
    }

    changed = true;
    return EditorSelection.range(trimmed.anchor, trimmed.head);
  });

  if (!changed) {
    return transaction;
  }

  return [
    transaction,
    {
      selection: EditorSelection.create(ranges, selection.mainIndex),
      scrollIntoView: transaction.scrollIntoView,
      sequential: true,
    },
  ];
});

function trimSingleLineBreakSelection(
  doc: Text,
  anchor: number,
  head: number,
): { anchor: number; head: number } | null {
  if (anchor === head) {
    return null;
  }

  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const line = doc.lineAt(from);

  if (line.number >= doc.lines) {
    return null;
  }

  const nextLine = doc.line(line.number + 1);
  if (to !== nextLine.from) {
    return null;
  }

  if (from > line.to) {
    return null;
  }

  const forward = anchor <= head;
  return {
    anchor: forward ? anchor : line.to,
    head: forward ? line.to : head,
  };
}

function linkClickExtension() {
  const openLinkFromEvent = (event: MouseEvent, view: EditorView): boolean => {
    if (event.defaultPrevented || event.button !== 0) {
      return false;
    }

    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".cm-typora-link")) {
      return false;
    }

    const pos = view.posAtCoords({
      x: event.clientX,
      y: event.clientY,
    });
    if (pos === null) {
      return false;
    }

    const href = findMarkdownLinkHrefAt(view.state, pos);
    if (!href) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    window.open(href, "_blank", "noopener,noreferrer");
    return true;
  };

  return EditorView.domEventHandlers({
    mousedown(event, view) {
      return openLinkFromEvent(event, view);
    },

    click(event, view) {
      return openLinkFromEvent(event, view);
    },
  });
}

function clipDecoratedSelectionBackgroundExtension() {
  let frameId = 0;

  const scheduleClip = (view: EditorView) => {
    if (frameId) {
      window.cancelAnimationFrame(frameId);
    }

    frameId = window.requestAnimationFrame(() => {
      frameId = 0;
      clipDecoratedSelectionBackgrounds(view);
    });
  };

  return EditorView.updateListener.of((update) => {
    if (
      !update.selectionSet &&
      !update.docChanged &&
      !update.viewportChanged &&
      !update.geometryChanged
    ) {
      return;
    }

    scheduleClip(update.view);
  });
}

const preserveLargeEnterScrollJumpExtension = EditorView.domEventHandlers({
  keydown(event, view) {
    if (event.key !== "Enter" || event.defaultPrevented) {
      return false;
    }

    const scrollDOM = view.scrollDOM;
    const scrollTop = scrollDOM.scrollTop;
    const scrollLeft = scrollDOM.scrollLeft;
    const restoreIfLargeJump = () => {
      if (Math.abs(scrollDOM.scrollTop - scrollTop) > 80) {
        scrollDOM.scrollTop = scrollTop;
      }
      if (Math.abs(scrollDOM.scrollLeft - scrollLeft) > 80) {
        scrollDOM.scrollLeft = scrollLeft;
      }
    };

    window.requestAnimationFrame(() => {
      restoreIfLargeJump();
      window.requestAnimationFrame(restoreIfLargeJump);
    });

    return false;
  },
});

function clipDecoratedSelectionBackgrounds(view: EditorView) {
  const selectionLayer = view.dom.querySelector(".cm-selectionLayer");
  if (!(selectionLayer instanceof HTMLElement)) {
    return;
  }

  const lineElements = Array.from(
    view.contentDOM.querySelectorAll(
      ".cm-line.cm-typora-code-line, .cm-line.cm-typora-blockquote-line, .cm-line.cm-typora-frontmatter-line",
    ),
  ).filter((line): line is HTMLElement => line instanceof HTMLElement);

  if (lineElements.length === 0) {
    return;
  }

  const layerRect = selectionLayer.getBoundingClientRect();
  const lineTextRects = lineElements
    .map((line) => ({
      line,
      rects: measureTextRectsForLine(line),
    }))
    .filter((entry) => entry.rects.length > 0);

  if (lineTextRects.length === 0) {
    return;
  }

  const backgrounds = Array.from(
    selectionLayer.querySelectorAll(".cm-selectionBackground"),
  ).filter((element): element is HTMLElement => element instanceof HTMLElement);

  for (const background of backgrounds) {
    restoreSelectionBackgroundGeometry(background);
  }

  for (const background of backgrounds) {
    const backgroundRect = background.getBoundingClientRect();
    const textRect = findTextRectForSelection(backgroundRect, lineTextRects);

    if (!textRect) {
      background.classList.remove("cm-typora-selection-clipped");
      continue;
    }

    const nextLeft = Math.max(backgroundRect.left, textRect.left);
    const nextRight = Math.min(backgroundRect.right, textRect.right);

    if (nextRight <= nextLeft) {
      background.classList.remove("cm-typora-selection-clipped");
      continue;
    }

    background.dataset.typoraOriginalLeft = background.style.left;
    background.dataset.typoraOriginalWidth = background.style.width;
    background.style.left = `${nextLeft - layerRect.left}px`;
    background.style.width = `${nextRight - nextLeft}px`;
    background.classList.add("cm-typora-selection-clipped");
  }
}

function restoreSelectionBackgroundGeometry(background: HTMLElement) {
  if (background.dataset.typoraOriginalLeft !== undefined) {
    background.style.left = background.dataset.typoraOriginalLeft;
    delete background.dataset.typoraOriginalLeft;
  }

  if (background.dataset.typoraOriginalWidth !== undefined) {
    background.style.width = background.dataset.typoraOriginalWidth;
    delete background.dataset.typoraOriginalWidth;
  }

  background.classList.remove("cm-typora-selection-clipped");
}

function measureTextRectsForLine(line: HTMLElement): DOMRect[] {
  const rects: DOMRect[] = [];
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();

  while (textNode) {
    const text = textNode.textContent ?? "";
    if (text.length > 0) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      rects.push(
        ...Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 1 && rect.height > 1,
        ),
      );
      range.detach();
    }
    textNode = walker.nextNode();
  }

  return rects.length > 0 ? rects : [line.getBoundingClientRect()];
}

function findTextRectForSelection(
  selectionRect: DOMRect,
  lineTextRects: Array<{ line: HTMLElement; rects: DOMRect[] }>,
): DOMRect | null {
  const selectionCenterY = selectionRect.top + selectionRect.height / 2;
  let bestRect: DOMRect | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const { rects } of lineTextRects) {
    for (const rect of rects) {
      if (selectionCenterY >= rect.top && selectionCenterY <= rect.bottom) {
        return rect;
      }

      const rectCenterY = rect.top + rect.height / 2;
      const distance = Math.abs(selectionCenterY - rectCenterY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestRect = rect;
      }
    }
  }

  if (!bestRect || bestDistance > Math.max(24, selectionRect.height * 1.8)) {
    return null;
  }

  return bestRect;
}

function findMarkdownLinkHrefAt(state: EditorState, position: number): string | null {
  const line = state.doc.lineAt(position);
  for (const match of line.text.matchAll(/(?<!!)\[([^\]\n]+)]\(([^)\n]+)\)/g)) {
    if (match.index === undefined) {
      continue;
    }
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (position >= from && position <= to) {
      return match[2].trim();
    }
  }
  return null;
}

function handleCodeFenceEnter(view: EditorView): boolean {
  if (!canCompleteFenceBlockOnEnter(view)) {
    return false;
  }

  const line = view.state.doc.lineAt(view.state.selection.main.head);
  view.dispatch({
    changes: {
      from: line.to,
      to: line.to,
      insert: "\n\n```",
    },
    selection: EditorSelection.cursor(line.to + 1),
    scrollIntoView: false,
    userEvent: "input.completeCodeBlock",
  });
  return true;
}

function canCompleteFenceBlockOnEnter(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const line = view.state.doc.lineAt(selection.head);
  if (selection.head !== line.to) {
    return false;
  }

  const fenceMatch = /^```([a-zA-Z0-9_-]+)?\s*$/.exec(line.text);
  if (!fenceMatch) {
    return false;
  }

  if (isLineInsideExistingFenceBlock(view.state, line.number)) {
    return false;
  }

  if (hasClosingFenceImmediatelyAfter(view.state, line.number, line.text)) {
    return false;
  }

  return true;
}

function exitFenceBlock(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const block = findFenceBlockAt(view.state, selection.head);
  if (!block) {
    return false;
  }

  const closeLine = view.state.doc.line(block.closeLineNumber);
  const nextLine = closeLine.number < view.state.doc.lines
    ? view.state.doc.line(closeLine.number + 1)
    : null;

  if (nextLine && nextLine.text.trim().length === 0) {
    view.dispatch({
      selection: EditorSelection.cursor(nextLine.from),
      scrollIntoView: true,
      userEvent: "input.exitCodeBlock",
    });
    return true;
  }

  view.dispatch({
    changes: {
      from: closeLine.to,
      to: closeLine.to,
      insert: "\n",
    },
    selection: EditorSelection.cursor(closeLine.to + 1),
    scrollIntoView: true,
    userEvent: "input.exitCodeBlock",
  });

  return true;
}

function imagePasteExtension(
  onImagePaste: ImagePasteHandler | undefined,
) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const items = event.clipboardData?.items;
      if (!items || !onImagePaste) {
        return false;
      }

      const hasImage = Array.from(items).some((item) => (item as DataTransferItem).type.startsWith("image/"));
      if (!hasImage) {
        return false;
      }

      const selection = view.state.selection.main;
      const capturedFrom = selection.from;
      const capturedTo = selection.to;
      event.preventDefault();
      event.stopPropagation();

      onImagePaste(items, (markdown) => {
        insertMarkdownAtPosition(view, markdown, capturedFrom, capturedTo);
      });

      return true;
    },
  });
}

function insertMarkdownAtPosition(
  view: EditorView,
  markdown: string,
  from: number,
  to: number,
) {
  const docLength = view.state.doc.length;
  const safeFrom = Math.max(0, Math.min(from, docLength));
  const safeTo = Math.max(safeFrom, Math.min(to, docLength));
  const insert = normalizePastedImageMarkdown(view, markdown, safeFrom);
  const beforeScrollTop = view.scrollDOM.scrollTop;

  view.dispatch({
    changes: {
      from: safeFrom,
      to: safeTo,
      insert,
    },
    selection: EditorSelection.cursor(safeFrom + insert.length),
  });

  const restoreScrollAndFocus = (attempt: number) => {
    view.scrollDOM.scrollTop = beforeScrollTop;
    view.focus();
    if (attempt < 3) {
      window.requestAnimationFrame(() => restoreScrollAndFocus(attempt + 1));
      return;
    }
  };

  window.requestAnimationFrame(() => restoreScrollAndFocus(0));
}

function normalizePastedImageMarkdown(
  view: EditorView,
  markdown: string,
  from: number,
): string {
  const trimmed = markdown.replace(/\s+$/g, "");
  const line = view.state.doc.lineAt(from);
  const beforeText = view.state.sliceDoc(line.from, from);
  const afterText = view.state.sliceDoc(from, line.to);
  const needsLeadingBreak = beforeText.trim().length > 0;
  const needsTrailingBreak = afterText.trim().length > 0;

  return `${needsLeadingBreak ? "\n" : ""}${trimmed}\n${needsTrailingBreak ? "" : ""}`;
}

function wrapSelection(
  view: EditorView,
  before: string,
  after: string,
  placeholder: string,
): boolean {
  if (isSelectionInsideFencedCode(view)) {
    return true;
  }

  const selection = view.state.selection.main;
  const selectedText =
    view.state.sliceDoc(selection.from, selection.to) || placeholder;
  const insert = `${before}${selectedText}${after}`;
  const anchor = selection.from + before.length;

  view.dispatch({
    changes: {
      from: selection.from,
      to: selection.to,
      insert,
    },
    selection: {
      anchor,
      head: anchor + selectedText.length,
    },
    scrollIntoView: false,
  });

  return true;
}

function toggleSelectionWrapper(
  view: EditorView,
  before: string,
  after: string,
  placeholder: string,
): boolean {
  if (isSelectionInsideFencedCode(view)) {
    return true;
  }

  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to);

  if (selectedText.startsWith(before) && selectedText.endsWith(after)) {
    const unwrapped = selectedText.slice(
      before.length,
      selectedText.length - after.length,
    );

    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: unwrapped,
      },
      selection: {
        anchor: selection.from,
        head: selection.from + unwrapped.length,
      },
      scrollIntoView: false,
    });
    return true;
  }

  const beforeSelection = view.state.sliceDoc(
    Math.max(0, selection.from - before.length),
    selection.from,
  );
  const afterSelection = view.state.sliceDoc(
    selection.to,
    Math.min(view.state.doc.length, selection.to + after.length),
  );

  if (selectedText && beforeSelection === before && afterSelection === after) {
    view.dispatch({
      changes: [
        {
          from: selection.from - before.length,
          to: selection.from,
          insert: "",
        },
        {
          from: selection.to,
          to: selection.to + after.length,
          insert: "",
        },
      ],
      selection: {
        anchor: selection.from - before.length,
        head: selection.to - before.length,
      },
      scrollIntoView: false,
    });
    return true;
  }

  return wrapSelection(view, before, after, placeholder);
}

function wrapLinkSelection(view: EditorView): boolean {
  if (isSelectionInsideFencedCode(view)) {
    return true;
  }

  const selection = view.state.selection.main;
  const selectedText =
    view.state.sliceDoc(selection.from, selection.to) || "link";
  const insert = `[${selectedText}](url)`;
  const anchor = selection.from + 1;

  view.dispatch({
    changes: {
      from: selection.from,
      to: selection.to,
      insert,
    },
    selection: {
      anchor,
      head: anchor + selectedText.length,
    },
    scrollIntoView: false,
  });

  return true;
}

function insertBlockInEditor(
  view: EditorView,
  before: string,
  after: string,
  placeholder: string,
): boolean {
  if (isSelectionInsideFencedCode(view)) {
    return true;
  }

  const selection = view.state.selection.main;
  const selectedText =
    view.state.sliceDoc(selection.from, selection.to) || placeholder;
  const insert = `${before}${selectedText}${after}`;
  const anchor = selection.from + before.length;

  view.dispatch({
    changes: {
      from: selection.from,
      to: selection.to,
      insert,
    },
    selection: {
      anchor,
      head: anchor + selectedText.length,
    },
    scrollIntoView: false,
  });

  return true;
}

function setCurrentLineHeading(view: EditorView, level: number): boolean {
  if (isSelectionInsideFencedCode(view)) {
    return true;
  }

  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const lineText = line.text;
  const withoutPrefix = lineText.replace(/^(#{1,6}\s+|>\s+|[-*]\s+|\d+\.\s+)/, "");
  const nextPrefix = level > 0 ? `${"#".repeat(level)} ` : "";
  const nextLine = `${nextPrefix}${withoutPrefix}`;

  view.dispatch({
    changes: {
      from: line.from,
      to: line.to,
      insert: nextLine,
    },
    selection: {
      anchor: Math.min(line.from + nextLine.length, line.from + nextPrefix.length + withoutPrefix.length),
    },
    scrollIntoView: false,
  });

  return true;
}

function typoraLiveDecorations(params: {
  activeFileId: string;
  workspaceRoot: string;
}) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildTyporaDecorations(state, params);
    },

    update(decorations, transaction) {
      if (transaction.docChanged || transaction.selection) {
        return buildTyporaDecorations(transaction.state, params);
      }

      return decorations;
    },

    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}

function addDecorationRange(
  ranges: TyporaDecorationRange[],
  from: number,
  to: number,
  decoration: Decoration,
) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return;
  }

  if (from < 0 || to < from) {
    return;
  }

  ranges.push(decoration.range(from, to));
}

function buildTyporaDecorations(
  state: EditorState,
  params: {
    activeFileId: string;
    workspaceRoot: string;
  },
): DecorationSet {
  const ranges: TyporaDecorationRange[] = [];
  const previewBlocks = collectPreviewBlocks(state);
  const frontmatterClosingLineNumber =
    state.doc.lines >= 2 && isFrontmatterDelimiter(state.doc.line(1).text)
      ? findFrontmatterClosingLine(state)?.number ?? 0
      : 0;
  let previewBlockIndex = 0;
  let inCodeFence = false;
  let fenceMarker = "";
  let currentCodeLanguage = "text";
  let codeFenceClosingLineNumber = 0;
  let isFirstCodeBodyLine = false;

  let position = 0;

  while (position <= state.doc.length) {
    const previewBlock = previewBlocks[previewBlockIndex];
    if (previewBlock && position === previewBlock.from) {
      if (
        previewBlock.type === "table" ||
        !isSelectionInsideRange(state, previewBlock.from, previewBlock.to)
      ) {
        addDecorationRange(
          ranges,
          previewBlock.from,
          previewBlock.to,
          Decoration.replace({
            block: true,
            widget: previewWidgetForBlock(previewBlock, params),
          }),
        );
        position = previewBlock.to + 1;
        previewBlockIndex += 1;
        continue;
      } else {
        previewBlockIndex += 1;
      }
    }

      const line = state.doc.lineAt(position);
      const lineText = line.text;
      const codeFence = parseCodeFenceLine(line.from, line.to, lineText);

      if (frontmatterClosingLineNumber > 0 && line.number <= frontmatterClosingLineNumber) {
        if (isFrontmatterDelimiter(lineText)) {
          addDecorationRange(ranges, line.from, line.from, frontmatterDelimiterLineDecoration);
          addDecorationRange(ranges, line.from, line.to, collapsedMarkdownMarkerDecoration);
        } else {
          addDecorationRange(ranges, line.from, line.from, frontmatterLineDecoration);
        }
        decorateInlineMarkup(ranges, line.from, lineText);
        if (line.to >= state.doc.length) {
          break;
        }
        position = line.to + 1;
        continue;
      }

      if (codeFence && !inCodeFence) {
        const closingFence = findClosingFenceLine(state, line.number, lineText);

        if (closingFence && !isSelectionInsideRange(state, line.from, line.to)) {
          currentCodeLanguage = normalizeCodeLanguage(codeFence.language);
          addDecorationRange(
            ranges,
            line.from,
            line.to,
            Decoration.replace({
              block: true,
              widget: new CodeFenceLanguageWidget(codeFence),
            }),
          );
          inCodeFence = true;
          fenceMarker = lineText.trimStart().startsWith("~~~") ? "~~~" : "```";
          codeFenceClosingLineNumber = closingFence.number;
          isFirstCodeBodyLine = true;
        } else {
          decorateMarkdownLine(ranges, line.from, lineText);
        }
      } else if (inCodeFence) {
        if (lineText.trimStart().startsWith(fenceMarker)) {
          addDecorationRange(ranges, line.from, line.from, hiddenCodeFenceLineDecoration);
          addDecorationRange(
            ranges,
            line.from,
            line.to,
            Decoration.replace({
              block: true,
              widget: new HiddenCodeFenceWidget(),
            }),
          );
          inCodeFence = false;
          fenceMarker = "";
          currentCodeLanguage = "text";
          codeFenceClosingLineNumber = 0;
          isFirstCodeBodyLine = false;
        } else {
          const isLastCodeBodyLine = line.number + 1 === codeFenceClosingLineNumber;
          const codeLineEdge: CodeLineEdge = isFirstCodeBodyLine && isLastCodeBodyLine
            ? "single"
            : isFirstCodeBodyLine
              ? "first"
              : isLastCodeBodyLine
                ? "last"
                : "middle";
          addDecorationRange(
            ranges,
            line.from,
            line.from,
            codeLineDecorationForLanguage(currentCodeLanguage, codeLineEdge),
          );
          decorateCodeSyntax(ranges, line.from, lineText, currentCodeLanguage);
          isFirstCodeBodyLine = false;
        }
      } else {
        decorateMarkdownLine(ranges, line.from, lineText);
      }

      if (line.to >= state.doc.length) {
        break;
      }
      position = line.to + 1;
  }

  return Decoration.set(ranges, true);
}

function previewWidgetForBlock(
  block: PreviewBlock,
  params: {
    activeFileId: string;
    workspaceRoot: string;
  },
): WidgetType {
  if (block.type === "hr") {
    return new HorizontalRuleWidget(block);
  }

  if (block.type === "math") {
    return new MathBlockPreviewWidget(block);
  }

  if (block.type === "blockquoteCallout") {
    return new CalloutPreviewWidget(block);
  }

  if (block.type === "table") {
    return new TablePreviewWidget(block);
  }

  if (block.type === "image") {
    const imageMatch = /!\[([^\]]*)\]\(([^)]+)\)/.exec(block.raw);
    return new MarkdownImagePreviewWidget({
      activeFileId: params.activeFileId,
      alt: imageMatch?.[1] ?? "",
      blockId: block.id,
      from: block.from,
      src: imageMatch?.[2] ?? "",
      to: block.to,
      workspaceRoot: params.workspaceRoot,
    });
  }

  if (block.type === "htmlImage") {
    return new HtmlImagePreviewWidget(block);
  }

  if (block.type === "plantuml") {
    return new PlantUmlPreviewWidget(block);
  }

  return new MermaidPreviewWidget(block);
}

function collectPreviewBlocks(state: EditorState): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  const doc = state.doc;
  const frontmatterClosingLineNumber =
    doc.lines >= 2 && isFrontmatterDelimiter(doc.line(1).text)
      ? findFrontmatterClosingLine(state)?.number ?? 0
      : 0;
  let lineNumber = 1;

  while (lineNumber <= doc.lines) {
    const line = doc.line(lineNumber);
    const lineText = line.text;

    if (frontmatterClosingLineNumber > 0 && lineNumber <= frontmatterClosingLineNumber) {
      lineNumber += 1;
      continue;
    }

    if (isHorizontalRuleLine(lineText)) {
      blocks.push(makePreviewBlock({
        from: line.from,
        raw: lineText,
        source: lineText,
        to: line.to,
        type: "hr",
      }));
      lineNumber += 1;
      continue;
    }

    if (isMathFenceLine(lineText)) {
      const closingLine = findMathClosingLine(state, lineNumber);
      if (closingLine) {
        const sourceFrom = Math.min(line.to + 1, doc.length);
        const sourceTo = Math.max(sourceFrom, closingLine.from - 1);
        blocks.push(makePreviewBlock({
          from: line.from,
          raw: state.sliceDoc(line.from, closingLine.to),
          source: state.sliceDoc(sourceFrom, sourceTo),
          to: closingLine.to,
          type: "math",
        }));
        lineNumber = closingLine.number + 1;
        continue;
      }
    }

    if (isCalloutStartLine(lineText)) {
      const endLine = findBlockquoteEndLine(state, lineNumber);
      blocks.push(makePreviewBlock({
        from: line.from,
        raw: state.sliceDoc(line.from, endLine.to),
        source: state.sliceDoc(line.from, endLine.to),
        to: endLine.to,
        type: "blockquoteCallout",
      }));
      lineNumber = endLine.number + 1;
      continue;
    }

    const fenceInfo = parseCodeFenceLine(line.from, line.to, lineText);

    if (fenceInfo) {
      const closingLine = findClosingFenceLine(state, lineNumber, lineText);
      const language = fenceInfo.language.toLowerCase();

      if (
        closingLine &&
        (language === "mermaid" ||
          language === "plantuml" ||
          language === "puml" ||
          language === "uml")
      ) {
        const sourceFrom = Math.min(line.to + 1, doc.length);
        const sourceTo = Math.max(sourceFrom, closingLine.from - 1);
        const source = state.sliceDoc(sourceFrom, sourceTo);

        blocks.push(makePreviewBlock({
          from: line.from,
          language,
          raw: state.sliceDoc(line.from, closingLine.to),
          source,
          to: closingLine.to,
          type: language === "mermaid" ? "mermaid" : "plantuml",
        }));
        lineNumber = closingLine.number + 1;
        continue;
      }
    }

    if (isImageOnlyLine(lineText)) {
      blocks.push(makePreviewBlock({
        from: line.from,
        raw: lineText,
        source: lineText,
        to: line.to,
        type: "image",
      }));
      lineNumber += 1;
      continue;
    }

    if (isHtmlImageOnlyLine(lineText)) {
      blocks.push(makePreviewBlock({
        from: line.from,
        raw: lineText,
        source: lineText,
        to: line.to,
        type: "htmlImage",
      }));
      lineNumber += 1;
      continue;
    }

    const tableEndLine = findMarkdownTableEndLine(state, lineNumber);
    if (tableEndLine) {
      blocks.push(makePreviewBlock({
        from: line.from,
        raw: state.sliceDoc(line.from, tableEndLine.to),
        source: state.sliceDoc(line.from, tableEndLine.to),
        to: tableEndLine.to,
        type: "table",
      }));
      lineNumber = tableEndLine.number + 1;
      continue;
    }

    lineNumber += 1;
  }

  return blocks;
}

function findClosingFenceLine(
  state: EditorState,
  openingLineNumber: number,
  openingLineText: string,
) {
  const marker = openingLineText.trimStart().startsWith("~~~") ? "~~~" : "```";

  for (
    let lineNumber = openingLineNumber + 1;
    lineNumber <= state.doc.lines;
    lineNumber += 1
  ) {
    const line = state.doc.line(lineNumber);
    if (line.text.trimStart().startsWith(marker)) {
      return line;
    }
  }

  return null;
}

function findFrontmatterClosingLine(state: EditorState) {
  for (let lineNumber = 2; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (isFrontmatterDelimiter(line.text)) {
      return line;
    }
  }

  return null;
}

function findMathClosingLine(state: EditorState, openingLineNumber: number) {
  for (
    let lineNumber = openingLineNumber + 1;
    lineNumber <= state.doc.lines;
    lineNumber += 1
  ) {
    const line = state.doc.line(lineNumber);
    if (isMathFenceLine(line.text)) {
      return line;
    }
  }

  return null;
}

function findBlockquoteEndLine(state: EditorState, startLineNumber: number) {
  let endLine = state.doc.line(startLineNumber);

  for (
    let lineNumber = startLineNumber + 1;
    lineNumber <= state.doc.lines;
    lineNumber += 1
  ) {
    const line = state.doc.line(lineNumber);
    if (!/^\s*>/.test(line.text)) {
      break;
    }
    endLine = line;
  }

  return endLine;
}

function hasClosingFenceImmediatelyAfter(
  state: EditorState,
  openingLineNumber: number,
  openingLineText: string,
): boolean {
  const nextLineNumber = openingLineNumber + 1;
  if (nextLineNumber > state.doc.lines) {
    return false;
  }

  const marker = openingLineText.trimStart().startsWith("~~~") ? "~~~" : "```";
  return state.doc.line(nextLineNumber).text.trim() === marker;
}

function findMarkdownTableEndLine(state: EditorState, startLineNumber: number) {
  if (startLineNumber + 1 > state.doc.lines) {
    return null;
  }

  const headerLine = state.doc.line(startLineNumber);
  const separatorLine = state.doc.line(startLineNumber + 1);

  if (!isTableRowLine(headerLine.text) || !isTableSeparatorLine(separatorLine.text)) {
    return null;
  }

  let endLine = separatorLine;

  for (
    let lineNumber = startLineNumber + 2;
    lineNumber <= state.doc.lines;
    lineNumber += 1
  ) {
    const line = state.doc.line(lineNumber);
    if (!isTableRowLine(line.text)) {
      break;
    }
    endLine = line;
  }

  return endLine;
}

function isSelectionInsideRange(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => {
    return range.from >= from && range.to <= to;
  });
}

function isSelectionInsideFencedCode(view: EditorView): boolean {
  const position = view.state.selection.main.from;
  let insideFence = false;
  let fenceMarker = "";

  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    if (line.from > position) {
      return insideFence;
    }

    const fence = parseCodeFenceLine(line.from, line.to, line.text);
    if (fence && !insideFence) {
      insideFence = true;
      fenceMarker = line.text.trimStart().startsWith("~~~") ? "~~~" : "```";
      continue;
    }

    if (insideFence && line.text.trimStart().startsWith(fenceMarker)) {
      return position <= line.to;
    }
  }

  return insideFence;
}

function isLineInsideExistingFenceBlock(
  state: EditorState,
  targetLineNumber: number,
): boolean {
  let insideFence = false;
  let fenceMarker = "";

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);

    if (lineNumber >= targetLineNumber) {
      return insideFence;
    }

    const fence = parseCodeFenceLine(line.from, line.to, line.text);
    if (fence && !insideFence) {
      insideFence = true;
      fenceMarker = line.text.trimStart().startsWith("~~~") ? "~~~" : "```";
      continue;
    }

    if (insideFence && line.text.trimStart().startsWith(fenceMarker)) {
      insideFence = false;
      fenceMarker = "";
    }
  }

  return false;
}

function findFenceBlockAt(
  state: EditorState,
  position: number,
): {
  closeLineNumber: number;
  openLineNumber: number;
} | null {
  let openLineNumber = 0;
  let insideFence = false;
  let fenceMarker = "";

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const fence = parseCodeFenceLine(line.from, line.to, line.text);

    if (fence && !insideFence) {
      insideFence = true;
      fenceMarker = line.text.trimStart().startsWith("~~~") ? "~~~" : "```";
      openLineNumber = lineNumber;

      if (position < line.from) {
        return null;
      }

      continue;
    }

    if (insideFence && line.text.trimStart().startsWith(fenceMarker)) {
      if (position >= state.doc.line(openLineNumber).from && position <= line.to) {
        return {
          closeLineNumber: lineNumber,
          openLineNumber,
        };
      }

      insideFence = false;
      fenceMarker = "";
      openLineNumber = 0;
    }

    if (line.from > position && !insideFence) {
      return null;
    }
  }

  return null;
}

function decorateMarkdownLine(
  ranges: TyporaDecorationRange[],
  lineFrom: number,
  lineText: string,
) {
  const headingMatch = /^(#{1,6})(\s+)(.*)$/.exec(lineText);
  if (headingMatch) {
    const level = headingMatch[1].length;
    addDecorationRange(ranges, lineFrom, lineFrom, headingLineDecorations[level - 1]);
    addDecorationRange(
      ranges,
      lineFrom,
      lineFrom + headingMatch[1].length + headingMatch[2].length,
      collapsedHeadingMarkerDecoration,
    );
  }

  const blockquoteMatch = /^(\s*)>(\s?)/.exec(lineText);
  if (blockquoteMatch) {
    const markerFrom = lineFrom + blockquoteMatch[1].length;
    const markerTo = markerFrom + 1 + blockquoteMatch[2].length;
    addDecorationRange(ranges, lineFrom, lineFrom, blockquoteLineDecoration);
    addDecorationRange(ranges, markerFrom, markerTo, collapsedMarkdownMarkerDecoration);
  }

  const taskMatch = /^(\s*)(?:([-*+])\s+)?\[([ xX])]\s+/.exec(lineText);
  if (taskMatch) {
    const markerFrom = lineFrom + taskMatch[1].length;
    const bulletLength = taskMatch[2] ? taskMatch[2].length + 1 : 0;
    const markerTo = markerFrom + bulletLength + 4;
    addDecorationRange(ranges, lineFrom, lineFrom, taskListLineDecoration);
    addDecorationRange(
      ranges,
      markerFrom,
      markerTo,
      Decoration.replace({
        widget: new TaskListMarkerWidget(
          taskMatch[3].toLowerCase() === "x",
          markerFrom + bulletLength + 1,
        ),
      }),
    );
  } else {
    const unorderedListMatch = /^(\s*)([-*+])\s+/.exec(lineText);
    if (unorderedListMatch) {
      const markerFrom = lineFrom + unorderedListMatch[1].length;
      const markerTo = markerFrom + unorderedListMatch[2].length + 1;
      addDecorationRange(ranges, lineFrom, lineFrom, unorderedListLineDecoration);
      addDecorationRange(
        ranges,
        markerFrom,
        markerTo,
        Decoration.replace({
          widget: new ListMarkerWidget("•"),
        }),
      );
    }
  }

  const orderedListMatch = /^(\s*)(\d+[.)])\s+/.exec(lineText);
  if (orderedListMatch) {
    const markerFrom = lineFrom + orderedListMatch[1].length;
    const markerTo = markerFrom + orderedListMatch[2].length + 1;
    addDecorationRange(ranges, lineFrom, lineFrom, orderedListLineDecoration);
    addDecorationRange(
      ranges,
      markerFrom,
      markerTo,
      Decoration.replace({
        widget: new ListMarkerWidget(orderedListMatch[2]),
      }),
    );
  }

  if (isTableLine(lineText)) {
    addDecorationRange(ranges, lineFrom, lineFrom, tableLineDecoration);
  }

  const imageMatch = /!\[([^\]]*)\]\(([^)]+)\)/.exec(lineText);
  if (imageMatch) {
    addDecorationRange(ranges, lineFrom, lineFrom, imageLineDecoration);
  }

  decorateInlineMarkup(ranges, lineFrom, lineText);
}

function decorateInlineMarkup(
  ranges: TyporaDecorationRange[],
  lineFrom: number,
  lineText: string,
) {
  const consumedMarkerRanges: Array<{ from: number; to: number }> = [];

  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /\*\*\*([^*\n]+)\*\*\*/g,
    3,
    [boldDecoration, italicDecoration],
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /___([^_\n]+)___/g,
    3,
    [boldDecoration, italicDecoration],
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /\*\*([^*\n]+)\*\*/g,
    2,
    boldDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /~~([^~\n]+)~~/g,
    2,
    strikeDecoration,
  );
  decorateInlineCode(ranges, consumedMarkerRanges, lineFrom, lineText);
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /<mark>(.*?)<\/mark>/g,
    { closeLength: 7, openLength: 6 },
    markDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /<kbd>(.*?)<\/kbd>/g,
    { closeLength: 6, openLength: 5 },
    kbdDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /__([^_\n]+)__/g,
    2,
    boldDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /<u>(.*?)<\/u>/g,
    { closeLength: 4, openLength: 3 },
    underlineDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /(^|[^*])\*([^*\n]+)\*/g,
    {
      closeLength: 1,
      contentGroup: 2,
      openLength: 1,
      prefixGroup: 1,
    },
    italicDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /(^|[^_])_([^_\n]+)_/g,
    {
      closeLength: 1,
      contentGroup: 2,
      openLength: 1,
      prefixGroup: 1,
    },
    italicDecoration,
  );
  decorateInlineMath(ranges, consumedMarkerRanges, lineFrom, lineText);
  decorateMarkdownLinks(ranges, consumedMarkerRanges, lineFrom, lineText);
}

function decorateInlineMath(
  ranges: TyporaDecorationRange[],
  consumedMarkerRanges: Array<{ from: number; to: number }>,
  lineFrom: number,
  lineText: string,
) {
  for (const match of lineText.matchAll(/(^|[^\$])\$([^\s$][^$\n]*?)\$(?!\$)/g)) {
    if (match.index === undefined) {
      continue;
    }

    const prefixLength = match[1].length;
    const source = match[2];
    const from = lineFrom + match.index + prefixLength;
    const to = from + source.length + 2;
    if (isRangeConsumed(consumedMarkerRanges, from, to)) {
      continue;
    }
    consumedMarkerRanges.push({ from, to });
    addDecorationRange(
      ranges,
      from,
      to,
      Decoration.replace({
        widget: new InlineMathWidget(source),
      }),
    );
  }
}

function decorateInlineCode(
  ranges: TyporaDecorationRange[],
  consumedMarkerRanges: Array<{ from: number; to: number }>,
  lineFrom: number,
  lineText: string,
) {
  for (const match of lineText.matchAll(/`([^`\n]+)`/g)) {
    if (match.index === undefined) {
      continue;
    }

    const from = lineFrom + match.index;
    const contentFrom = from + 1;
    const contentTo = contentFrom + match[1].length;
    const to = contentTo + 1;
    if (isRangeConsumed(consumedMarkerRanges, from, to)) {
      continue;
    }

    consumedMarkerRanges.push({ from, to });
    addDecorationRange(ranges, from, contentFrom, hiddenMarkdownMarkerDecoration);
    addDecorationRange(ranges, contentFrom, contentTo, inlineCodeDecoration);
    addDecorationRange(ranges, contentTo, to, hiddenMarkdownMarkerDecoration);
  }
}

function decorateInlineWrapper(
  ranges: TyporaDecorationRange[],
  consumedMarkerRanges: Array<{ from: number; to: number }>,
  lineFrom: number,
  lineText: string,
  regex: RegExp,
  markerConfig:
    | number
    | {
        closeLength: number;
        contentGroup?: number;
        openLength: number;
        prefixGroup?: number;
      },
  contentDecoration: Decoration | Decoration[],
) {
  for (const match of lineText.matchAll(regex)) {
    if (match.index === undefined) {
      continue;
    }

    const contentGroup =
      typeof markerConfig === "number"
        ? 1
        : markerConfig.contentGroup ?? 1;
    const prefixLength =
      typeof markerConfig === "number"
        ? 0
        : markerConfig.prefixGroup
          ? match[markerConfig.prefixGroup].length
          : 0;
    const openLength =
      typeof markerConfig === "number"
        ? markerConfig
        : markerConfig.openLength;
    const closeLength =
      typeof markerConfig === "number"
        ? markerConfig
        : markerConfig.closeLength;
    const content = match[contentGroup];
    const from = lineFrom + match.index + prefixLength;
    const contentFrom = from + openLength;
    const contentTo = contentFrom + content.length;
    const to = contentTo + closeLength;

    if (
      isRangeConsumed(consumedMarkerRanges, from, contentFrom) ||
      isRangeConsumed(consumedMarkerRanges, contentTo, to)
    ) {
      continue;
    }

    consumedMarkerRanges.push(
      { from, to: contentFrom },
      { from: contentTo, to },
    );
    addDecorationRange(ranges, from, contentFrom, hiddenMarkdownMarkerDecoration);
    const contentDecorations = Array.isArray(contentDecoration)
      ? contentDecoration
      : [contentDecoration];
    for (const decoration of contentDecorations) {
      addDecorationRange(ranges, contentFrom, contentTo, decoration);
    }
    addDecorationRange(ranges, contentTo, to, hiddenMarkdownMarkerDecoration);
  }
}

function decorateMarkdownLinks(
  ranges: TyporaDecorationRange[],
  consumedMarkerRanges: Array<{ from: number; to: number }>,
  lineFrom: number,
  lineText: string,
) {
  for (const match of lineText.matchAll(/(?<!!)\[([^\]\n]+)]\(([^)\n]+)\)/g)) {
    if (match.index === undefined) {
      continue;
    }

    const label = match[1];
    const from = lineFrom + match.index;
    const labelFrom = from + 1;
    const labelTo = labelFrom + label.length;
    const to = from + match[0].length;

    if (
      isRangeConsumed(consumedMarkerRanges, from, labelFrom) ||
      isRangeConsumed(consumedMarkerRanges, labelTo, to)
    ) {
      continue;
    }

    consumedMarkerRanges.push(
      { from, to: labelFrom },
      { from: labelTo, to },
    );
    addDecorationRange(ranges, from, labelFrom, hiddenMarkdownMarkerDecoration);
    addDecorationRange(ranges, labelFrom, labelTo, linkDecoration);
    addDecorationRange(ranges, labelTo, to, hiddenMarkdownMarkerDecoration);
  }
}

function isRangeConsumed(
  consumedRanges: Array<{ from: number; to: number }>,
  from: number,
  to: number,
): boolean {
  return consumedRanges.some((range) => from < range.to && to > range.from);
}

function decorateCodeSyntax(
  ranges: TyporaDecorationRange[],
  lineFrom: number,
  lineText: string,
  language: string,
) {
  const tokens: Array<{ from: number; to: number; decoration: Decoration }> = [];
  const normalized = normalizeCodeLanguage(language);

  const addMatches = (regex: RegExp, decoration: Decoration, groupIndex = 0) => {
    for (const match of lineText.matchAll(regex)) {
      if (match.index === undefined) {
        continue;
      }

      const value = match[groupIndex];
      if (!value) {
        continue;
      }

      const prefix = lineText.slice(match.index, match.index + match[0].length).indexOf(value);
      const from = lineFrom + match.index + Math.max(0, prefix);
      tokens.push({
        from,
        to: from + value.length,
        decoration,
      });
    }
  };

  if (["json", "javascript", "typescript", "tsx", "java", "rust", "go", "kotlin", "yaml", "sql", "bash", "shell", "xml", "html", "css", "python", "properties"].includes(normalized)) {
    addMatches(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, codeTokenDecorations.string);
    addMatches(/(^|[^\w.])(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, codeTokenDecorations.number, 2);
  }

  if (normalized === "json") {
    addMatches(/"(?:\\.|[^"\\])*"(?=\s*:)/g, codeTokenDecorations.property);
    addMatches(/\b(true|false)\b/g, codeTokenDecorations.boolean, 1);
    addMatches(/\bnull\b/g, codeTokenDecorations.keyword);
  }

  if (["javascript", "typescript", "tsx", "java", "rust", "go", "kotlin", "python"].includes(normalized)) {
    addMatches(/\/\/.*$/g, codeTokenDecorations.comment);
    addMatches(/\b(const|let|var|function|return|if|else|for|while|class|interface|type|enum|import|export|from|new|try|catch|finally|throw|async|await|public|private|protected|static|final|void|int|long|double|float|boolean|String|record|sealed|extends|implements|package|use|fn|struct|impl|trait|mut|val|fun|def|self|None|True|False)\b/g, codeTokenDecorations.keyword, 1);
  }

  if (["bash", "shell", "yaml", "properties", "python"].includes(normalized)) {
    addMatches(/#.*/g, codeTokenDecorations.comment);
  }

  if (normalized === "sql") {
    addMatches(/--.*$/g, codeTokenDecorations.comment);
    addMatches(/\b(select|from|where|insert|update|delete|create|alter|drop|join|left|right|inner|outer|on|group|by|order|limit|offset|and|or|not|null|is|in|exists|case|when|then|else|end|as|index|table|primary|key|unique)\b/gi, codeTokenDecorations.keyword, 1);
  }

  if (["xml", "html"].includes(normalized)) {
    addMatches(/<!--.*?-->/g, codeTokenDecorations.comment);
    addMatches(/<\/?[A-Za-z][A-Za-z0-9:-]*/g, codeTokenDecorations.tag);
    addMatches(/\s([A-Za-z_:][A-Za-z0-9_.:-]*)(?=\=)/g, codeTokenDecorations.attr, 1);
  }

  if (normalized === "css") {
    addMatches(/\/\*.*?\*\//g, codeTokenDecorations.comment);
    addMatches(/(^|[{};])\s*([A-Za-z-]+)(?=\s*:)/g, codeTokenDecorations.property, 2);
  }

  tokens.sort((left, right) => left.from - right.from || left.to - right.to);

  let lastTo = lineFrom;
  for (const token of tokens) {
    if (token.from < lastTo || token.from >= token.to) {
      continue;
    }

    addDecorationRange(ranges, token.from, token.to, token.decoration);
    lastTo = token.to;
  }
}

function parseCodeFenceLine(
  lineFrom: number,
  lineTo: number,
  lineText: string,
): CodeFenceInfo | null {
  const match = /^(\s*)(`{3,}|~{3,})([^\s`]*)?/.exec(lineText);
  if (!match) {
    return null;
  }

  const markerTo = lineFrom + match[1].length + match[2].length;
  const language = match[3] ?? "";
  const languageFrom = markerTo;
  const languageTo = Math.min(lineTo, languageFrom + language.length);

  return {
    lineFrom,
    lineTo,
    markerTo,
    languageFrom,
    languageTo,
    language,
  };
}

function isTableLine(lineText: string): boolean {
  return /^\s*\|.+\|\s*$/.test(lineText) || /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lineText);
}

function isTableRowLine(lineText: string): boolean {
  return /^\s*\|.+\|\s*$/.test(lineText);
}

function isTableSeparatorLine(lineText: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lineText);
}

function isImageOnlyLine(lineText: string): boolean {
  return /^\s*!\[[^\]]*]\([^)]+\)\s*$/.test(lineText);
}

function isHtmlImageOnlyLine(lineText: string): boolean {
  return /^\s*<img\b[^>]*>\s*$/i.test(lineText);
}

function isFrontmatterDelimiter(lineText: string): boolean {
  return /^\s*---\s*$/.test(lineText);
}

function isHorizontalRuleLine(lineText: string): boolean {
  return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(lineText);
}

function isMathFenceLine(lineText: string): boolean {
  return /^\s*\$\$\s*$/.test(lineText);
}

function isCalloutStartLine(lineText: string): boolean {
  return /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)]/i.test(lineText);
}

function isRemoteOrDataImage(src: string): boolean {
  return /^(https?:)?\/\//i.test(src) || /^data:image\//i.test(src);
}

function parseTableCells(lineText: string): string[] {
  return lineText
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseTableAlignments(separatorLine: string, columnCount: number): TableAlignment[] {
  const cells = parseTableCells(separatorLine);
  return Array.from({ length: columnCount }, (_, index) =>
    parseTableAlignmentCell(cells[index] ?? "---"),
  );
}

function parseTableAlignmentCell(cell: string): TableAlignment {
  const normalized = cell.trim();
  const starts = normalized.startsWith(":");
  const ends = normalized.endsWith(":");

  if (starts && ends) {
    return "center";
  }

  if (ends) {
    return "right";
  }

  if (starts) {
    return "left";
  }

  return "default";
}

function serializeTableAlignmentCell(alignment: TableAlignment, width = 3): string {
  const dashCount = Math.max(3, width);
  if (alignment === "center") {
    return `:${"-".repeat(dashCount)}:`;
  }
  if (alignment === "right") {
    return `${"-".repeat(dashCount)}:`;
  }
  if (alignment === "left") {
    return `:${"-".repeat(dashCount)}`;
  }
  return "-".repeat(dashCount);
}

function cssTextAlignForTableAlignment(alignment: TableAlignment): "center" | "left" | "right" {
  if (alignment === "center" || alignment === "right") {
    return alignment;
  }
  return "left";
}

function parseHtmlAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/\s([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name) {
      attributes[name] = value;
    }
  }
  return attributes;
}

function revealSource(dom: HTMLElement, block: Pick<PreviewBlock, "from">) {
  const view = EditorView.findFromDOM(dom);
  if (!view) {
    return;
  }

  view.dispatch({
    selection: {
      anchor: block.from,
    },
    scrollIntoView: true,
  });
  view.focus();
}

function allowEditorVerticalScroll(element: HTMLElement) {
  element.dataset.allowNativeEditorWheel = "true";
}

function scheduleEditorMeasureFromDom(element: HTMLElement) {
  const requestMeasure = (restoreFrames = 1) => {
    const view = EditorView.findFromDOM(element);
    if (!view) {
      return;
    }

    const scrollDOM = view.scrollDOM;
    const scrollTop = scrollDOM.scrollTop;
    const scrollLeft = scrollDOM.scrollLeft;
    const restoreScroll = () => {
      scrollDOM.scrollTop = scrollTop;
      scrollDOM.scrollLeft = scrollLeft;
    };

    view.requestMeasure();
    restoreScroll();

    let remainingFrames = restoreFrames;
    const restoreAfterFrame = () => {
      restoreScroll();
      remainingFrames -= 1;
      if (remainingFrames > 0) {
        window.requestAnimationFrame(restoreAfterFrame);
      }
    };
    window.requestAnimationFrame(restoreAfterFrame);
  };

  requestMeasure(2);
}

function initializeMermaid(): void {
  if (mermaidInitialized) {
    return;
  }

  mermaid.initialize({
    ...mermaidDiagramConfig,
  });
  mermaidInitialized = true;
}

function diagramIdForSource(source: string): string {
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return `polarbear-live-mermaid-${hash}`;
}

class ListMarkerWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  eq(other: ListMarkerWidget): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "cm-typora-list-marker";
    marker.textContent = this.label;
    return marker;
  }
}

class TaskListMarkerWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly checkboxCharFrom: number,
  ) {
    super();
  }

  eq(other: TaskListMarkerWidget): boolean {
    return (
      other.checked === this.checked &&
      other.checkboxCharFrom === this.checkboxCharFrom
    );
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = this.checked
      ? "cm-typora-task-marker cm-typora-task-marker-checked"
      : "cm-typora-task-marker";
    marker.textContent = this.checked ? "✓" : "";
    marker.setAttribute("aria-label", this.checked ? "Task checked" : "Task unchecked");
    marker.setAttribute("role", "checkbox");
    marker.setAttribute("aria-checked", String(this.checked));

    const toggle = () => {
      const view = EditorView.findFromDOM(marker);
      if (!view) {
        return;
      }
      const scrollTop = view.scrollDOM.scrollTop;
      const scrollLeft = view.scrollDOM.scrollLeft;
      view.dispatch({
        changes: {
          from: this.checkboxCharFrom,
          to: this.checkboxCharFrom + 1,
          insert: this.checked ? " " : "x",
        },
        scrollIntoView: false,
        userEvent: "input.taskToggle",
      });
      view.scrollDOM.scrollTop = scrollTop;
      view.scrollDOM.scrollLeft = scrollLeft;
      window.requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = scrollTop;
        view.scrollDOM.scrollLeft = scrollLeft;
      });
    };

    marker.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    marker.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    marker.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    });
    marker.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        toggle();
      }
    });
    return marker;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class InlineMathWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  eq(other: InlineMathWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-typora-inline-math";
    span.textContent = renderMathText(this.source);
    return span;
  }
}

class HorizontalRuleWidget extends WidgetType {
  constructor(private readonly block: PreviewBlock) {
    super();
  }

  eq(other: HorizontalRuleWidget): boolean {
    return other.block.id === this.block.id;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-horizontal-rule";
    markMarkdownPreviewBlock(wrapper, this.block);
    const rule = document.createElement("hr");
    wrapper.append(rule);
    return wrapper;
  }
}

class MathBlockPreviewWidget extends WidgetType {
  constructor(private readonly block: PreviewBlock) {
    super();
  }

  eq(other: MathBlockPreviewWidget): boolean {
    return other.block.id === this.block.id && other.block.source === this.block.source;
  }

  get estimatedHeight(): number {
    const lineCount = Math.max(1, this.block.source.split(/\r?\n/).length);
    if (/\\begin\{cases\}/.test(this.block.source)) {
      return Math.max(132, lineCount * 28);
    }
    return Math.max(76, lineCount * 28);
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-math-block";
    markMarkdownPreviewBlock(wrapper, this.block, "markdown-math-block");
    wrapper.title = "Click to edit formula source";
    wrapper.addEventListener("click", () => revealSource(wrapper, this.block));
    wrapper.addEventListener("dblclick", () => revealSource(wrapper, this.block));
    renderMathBlockDom(wrapper, this.block.source);
    allowEditorVerticalScroll(wrapper);
    scheduleEditorMeasureFromDom(wrapper);
    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function renderMathBlockDom(wrapper: HTMLElement, source: string) {
  const normalized = source.trim();
  const casesMatch = /([\s\S]*?)=\s*\\begin\{cases\}([\s\S]*?)\\end\{cases\}/.exec(normalized);

  if (casesMatch) {
    const formula = document.createElement("div");
    formula.className = "cm-typora-math-cases";

    const left = document.createElement("span");
    left.className = "cm-typora-math-left";
    left.textContent = `${renderMathText(casesMatch[1].trim())} =`;

    const brace = document.createElement("span");
    brace.className = "cm-typora-math-brace";
    brace.textContent = "{";

    const rows = document.createElement("span");
    rows.className = "cm-typora-math-case-rows";
    casesMatch[2]
      .split(/\\\\/)
      .map((row) => row.trim())
      .filter(Boolean)
      .forEach((row) => {
        const [value = "", condition = ""] = row.split("&");
        const rowElement = document.createElement("span");
        rowElement.className = "cm-typora-math-case-row";

        const valueElement = document.createElement("span");
        valueElement.className = "cm-typora-math-case-value";
        valueElement.textContent = renderMathText(value.replace(/,\s*$/, "").trim());

        const conditionElement = document.createElement("span");
        conditionElement.className = "cm-typora-math-case-condition";
        conditionElement.textContent = renderMathText(condition.trim());

        rowElement.append(valueElement, conditionElement);
        rows.append(rowElement);
      });

    formula.append(left, brace, rows);
    wrapper.append(formula);
    return;
  }

  const formula = document.createElement("div");
  formula.className = "cm-typora-math-equation";
  formula.textContent = renderMathText(normalized);
  wrapper.append(formula);
}

function renderMathText(source: string): string {
  return source
    .replace(/\\times/g, "×")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\in/g, "∈")
    .replace(/\\epsilon/g, "ε")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\delta/g, "δ")
    .replace(/\\_/g, "_")
    .replace(/([A-Za-z])_([0-9]+)/g, (_, name: string, digits: string) =>
      `${name}${toSubscript(digits)}`,
    )
    .replace(/\{([^{}]+)\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function toSubscript(value: string): string {
  const map: Record<string, string> = {
    "0": "₀",
    "1": "₁",
    "2": "₂",
    "3": "₃",
    "4": "₄",
    "5": "₅",
    "6": "₆",
    "7": "₇",
    "8": "₈",
    "9": "₉",
  };
  return value.replace(/[0-9]/g, (digit) => map[digit] ?? digit);
}

class CalloutPreviewWidget extends WidgetType {
  constructor(private readonly block: PreviewBlock) {
    super();
  }

  eq(other: CalloutPreviewWidget): boolean {
    return other.block.id === this.block.id && other.block.raw === this.block.raw;
  }

  toDOM(): HTMLElement {
    const lines = this.block.raw.split(/\r?\n/).map((line) =>
      line.replace(/^\s*>\s?/, ""),
    );
    const firstLine = lines[0] ?? "";
    const typeMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)]\s*(.*)$/i.exec(firstLine);
    const type = (typeMatch?.[1] ?? "NOTE").toLowerCase();
    const titleText = typeMatch?.[2]?.trim() || type.toUpperCase();
    const bodyLines = [titleText, ...lines.slice(1)].filter((line, index) =>
      index === 0 || line.trim().length > 0,
    );

    const wrapper = document.createElement("aside");
    wrapper.className = `cm-typora-callout cm-typora-callout-${type}`;
    markMarkdownPreviewBlock(wrapper, this.block, "markdown-callout-block");
    const title = document.createElement("div");
    title.className = "cm-typora-callout-title";
    title.textContent = titleText;
    const body = document.createElement("div");
    body.className = "cm-typora-callout-body";
    bodyLines.slice(1).forEach((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      body.append(paragraph);
    });
    wrapper.append(title, body);
    allowEditorVerticalScroll(wrapper);
    scheduleEditorMeasureFromDom(wrapper);
    return wrapper;
  }
}

class HtmlImagePreviewWidget extends WidgetType {
  constructor(private readonly block: PreviewBlock) {
    super();
  }

  eq(other: HtmlImagePreviewWidget): boolean {
    return other.block.id === this.block.id && other.block.raw === this.block.raw;
  }

  toDOM(): HTMLElement {
    const attributes = parseHtmlAttributes(this.block.raw);
    const figure = document.createElement("figure");
    figure.className = "cm-typora-image-preview cm-typora-html-image-preview";
    markMarkdownPreviewBlock(figure, this.block, "markdown-image-block");
    allowEditorVerticalScroll(figure);

    const src = attributes.src ?? "";
    if (!src) {
      figure.classList.add("cm-typora-image-error");
      const caption = document.createElement("figcaption");
      caption.textContent = "Image src is missing.";
      figure.append(caption);
      return figure;
    }

    const image = document.createElement("img");
    image.src = src;
    image.alt = attributes.alt ?? "";
    if (attributes.width) {
      image.style.width = /^\d+$/.test(attributes.width)
        ? `${attributes.width}px`
        : attributes.width;
    }
    if (attributes.height) {
      image.style.height = /^\d+$/.test(attributes.height)
        ? `${attributes.height}px`
        : attributes.height;
    }
    figure.append(image);
    if (attributes.alt) {
      const caption = document.createElement("figcaption");
      caption.textContent = attributes.alt;
      figure.append(caption);
    }
    scheduleEditorMeasureFromDom(figure);
    return figure;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class TablePreviewWidget extends WidgetType {
  constructor(private readonly block: PreviewBlock) {
    super();
  }

  eq(other: TablePreviewWidget): boolean {
    return other.block.id === this.block.id && other.block.raw === this.block.raw;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-table-preview";
    markMarkdownPreviewBlock(wrapper, this.block, "markdown-table-block");
    wrapper.title = "Markdown table preview";
    allowEditorVerticalScroll(wrapper);

    const lines = this.block.raw.split(/\r?\n/);
    const [headerLine, separatorLine = "", ...bodyLines] = lines;
    const headers = parseTableCells(headerLine ?? "");
    const alignments = parseTableAlignments(separatorLine, headers.length);
    const rowCount = bodyLines.filter(isTableRowLine).length + 1;
    const columnCount = headers.length;

    const toolbar = document.createElement("div");
    toolbar.className = "cm-typora-table-toolbar";

    const leftTools = document.createElement("div");
    leftTools.className = "cm-typora-table-toolbar-left";

    const gridButton = createTableToolbarButton("grid", "Table size");
    gridButton.classList.add("cm-typora-table-grid-button");
    gridButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTableSizeMenu(wrapper, this.block, gridButton);
    });

    const alignLeftButton = createTableToolbarButton("align-left", "Align Left");
    alignLeftButton.classList.add("cm-typora-table-align-left-button");
    alignLeftButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyTableOperation(wrapper, this.block, (nextLines) =>
        setTableColumnAlignment(nextLines, activeTableColumn(wrapper), "left"),
      );
    });

    const alignCenterButton = createTableToolbarButton("align-center", "Align Center");
    alignCenterButton.classList.add("cm-typora-table-align-center-button");
    alignCenterButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyTableOperation(wrapper, this.block, (nextLines) =>
        setTableColumnAlignment(nextLines, activeTableColumn(wrapper), "center"),
      );
    });

    const alignRightButton = createTableToolbarButton("align-right", "Align Right");
    alignRightButton.classList.add("cm-typora-table-align-right-button");
    alignRightButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyTableOperation(wrapper, this.block, (nextLines) =>
        setTableColumnAlignment(nextLines, activeTableColumn(wrapper), "right"),
      );
    });

    leftTools.append(gridButton, alignLeftButton, alignCenterButton, alignRightButton);

    const deleteButton = createTableToolbarButton("delete", "Delete table");
    deleteButton.className = "cm-typora-table-delete-button";
    deleteButton.setAttribute("aria-label", "Delete table");
    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyTableEdit(wrapper, this.block, "");
    });

    toolbar.append(leftTools, deleteButton);
    wrapper.append(toolbar);

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    let tableFocusIndex = 0;

    headers.forEach((header, columnIndex) => {
      const th = document.createElement("th");
      th.style.textAlign = cssTextAlignForTableAlignment(alignments[columnIndex] ?? "default");
      makeTableCellEditable(th, {
        block: this.block,
        columnIndex,
        focusIndex: tableFocusIndex,
        sourceLineIndex: 0,
        value: header,
        wrapper,
      });
      tableFocusIndex += 1;
      headerRow.append(th);
    });

    thead.append(headerRow);
    table.append(thead);

    const tbody = document.createElement("tbody");
    bodyLines.forEach((bodyLine, bodyIndex) => {
      if (!isTableRowLine(bodyLine)) {
        return;
      }
      const row = document.createElement("tr");
      parseTableCells(bodyLine).forEach((cell, columnIndex) => {
        const td = document.createElement("td");
        td.style.textAlign = cssTextAlignForTableAlignment(alignments[columnIndex] ?? "default");
        makeTableCellEditable(td, {
          block: this.block,
          columnIndex,
          focusIndex: tableFocusIndex,
          sourceLineIndex: bodyIndex + 2,
          value: cell,
          wrapper,
        });
        tableFocusIndex += 1;
        row.append(td);
      });
      tbody.append(row);
    });
    table.append(tbody);
    wrapper.append(table);
    scheduleEditorMeasureFromDom(wrapper);

    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function makeTableCellEditable(
  cell: HTMLTableCellElement,
  params: {
    block: PreviewBlock;
    columnIndex: number;
    focusIndex: number;
    sourceLineIndex: number;
    value: string;
    wrapper: HTMLElement;
  },
) {
  cell.contentEditable = "true";
  cell.spellcheck = true;
  renderTableCellValue(cell, params.value);
  cell.setAttribute("role", "textbox");
  cell.setAttribute("aria-label", "Edit table cell");
  cell.dataset.tableFocusIndex = String(params.focusIndex);

  let committedValue = params.value;

  const commit = (): boolean => {
    const nextValue = markdownFromTableCellElement(cell);
    if (nextValue === committedValue) {
      return true;
    }

    const view = EditorView.findFromDOM(params.wrapper);
    if (!view) {
      renderTableCellValue(cell, committedValue);
      return false;
    }

    const nextRaw = updateMarkdownTableCell(
      params.block.raw,
      params.sourceLineIndex,
      params.columnIndex,
      nextValue,
    );

    if (nextRaw === params.block.raw) {
      renderTableCellValue(cell, committedValue);
      return false;
    }

    committedValue = nextValue;
    const scrollDOM = view.scrollDOM;
    const scrollTop = scrollDOM.scrollTop;
    const scrollLeft = scrollDOM.scrollLeft;

    view.dispatch({
      changes: {
        from: params.block.from,
        to: params.block.to,
        insert: nextRaw,
      },
      scrollIntoView: false,
      userEvent: "input.tableCell",
    });

    scrollDOM.scrollTop = scrollTop;
    scrollDOM.scrollLeft = scrollLeft;
    return true;
  };

  cell.addEventListener("mousedown", (event) => event.stopPropagation());
  cell.addEventListener("click", (event) => event.stopPropagation());
  cell.addEventListener("input", (event) => event.stopPropagation());
  cell.addEventListener("focus", () => {
    params.wrapper.dataset.activeColumn = String(params.columnIndex);
  });
  cell.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTableActionMenu(params.wrapper, params.block, cell, {
      columnIndex: params.columnIndex,
      sourceLineIndex: params.sourceLineIndex,
    });
  });
  cell.addEventListener("blur", commit);
  cell.addEventListener("keydown", (event) => {
    event.stopPropagation();

    if (event.key === "Tab") {
      event.preventDefault();
      const nextFocusIndex = params.focusIndex + (event.shiftKey ? -1 : 1);
      if (commit()) {
        focusTableCellAfterCommit(params.wrapper, params.block.from, nextFocusIndex);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        insertLineBreakAtCurrentSelection();
        return;
      }
      commit();
      cell.blur();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      document.execCommand("bold");
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      renderTableCellValue(cell, committedValue);
      cell.blur();
    }
  });
}

function createTableToolbarButton(iconName: string, ariaLabel: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-typora-table-tool-button";
  button.title = ariaLabel;
  button.setAttribute("aria-label", ariaLabel);
  button.append(createTableIcon(iconName));
  return button;
}

function createTableIcon(iconName: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 18 18");
  svg.setAttribute("aria-hidden", "true");

  const addPath = (d: string) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  };

  if (iconName === "grid") {
    addPath("M3 3.5h4.5V8H3zM10.5 3.5H15V8h-4.5zM3 10h4.5v4.5H3zM10.5 10H15v4.5h-4.5z");
  } else if (iconName === "align-left") {
    addPath("M4 5h10M4 9h7M4 13h10");
  } else if (iconName === "align-center") {
    addPath("M4 5h10M5.5 9h7M4 13h10");
  } else if (iconName === "align-right") {
    addPath("M4 5h10M7 9h7M4 13h10");
  } else {
    addPath("M6.5 4.5V3h5v1.5M4.5 5.5h9M6 7v7M9 7v7M12 7v7");
  }

  return svg;
}

function activeTableColumn(wrapper: HTMLElement): number {
  const activeColumn = Number.parseInt(wrapper.dataset.activeColumn ?? "0", 10);
  return Number.isFinite(activeColumn) ? activeColumn : 0;
}

function openTableSizeMenu(
  wrapper: HTMLElement,
  block: PreviewBlock,
  anchorElement: HTMLElement,
) {
  closeTableActionMenus(wrapper);

  const menu = document.createElement("div");
  menu.className = "cm-typora-table-size-menu";

  const grid = document.createElement("div");
  grid.className = "cm-typora-table-size-grid";
  const label = document.createElement("div");
  label.className = "cm-typora-table-size-label";

  const currentLines = block.raw.split(/\r?\n/);
  const currentRows = Math.max(1, currentLines.filter(isTableRowLine).length - 1);
  const currentColumns = tableColumnCount(currentLines);
  let selectedRows = currentRows;
  let selectedColumns = currentColumns;

  const updateGrid = (rows: number, columns: number) => {
    selectedRows = rows;
    selectedColumns = columns;
    label.textContent = `${columns} x ${rows}`;
    for (const cell of grid.querySelectorAll<HTMLButtonElement>("button")) {
      const row = Number.parseInt(cell.dataset.row ?? "0", 10);
      const column = Number.parseInt(cell.dataset.column ?? "0", 10);
      cell.classList.toggle(
        "cm-typora-table-size-cell-active",
        row <= rows && column <= columns,
      );
    }
  };

  for (let row = 1; row <= 8; row += 1) {
    for (let column = 1; column <= 8; column += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.setAttribute("aria-label", `${column} columns, ${row} rows`);
      cell.addEventListener("mouseenter", () => updateGrid(row, column));
      cell.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeTableActionMenus(wrapper);
        applyTableOperation(wrapper, block, (lines) =>
          resizeMarkdownTable(lines, selectedRows, selectedColumns),
        );
      });
      grid.append(cell);
    }
  }

  updateGrid(selectedRows, selectedColumns);
  menu.append(grid, label);
  document.body.append(menu);

  const anchorRect = anchorElement.getBoundingClientRect();
  positionTablePortalMenu(menu, anchorRect.left, anchorRect.bottom + 4);

  const closeOnOutsidePointer = (event: PointerEvent) => {
    if (event.target instanceof Node && menu.contains(event.target)) {
      return;
    }
    closeTableActionMenus(wrapper);
    document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  };

  window.requestAnimationFrame(() => {
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
  });
}

function openTableActionMenu(
  wrapper: HTMLElement,
  block: PreviewBlock,
  anchorElement: HTMLElement,
  position: {
    columnIndex: number;
    sourceLineIndex: number;
  },
) {
  closeTableActionMenus(wrapper);

  const menu = document.createElement("div");
  menu.className = "cm-typora-table-menu";
  menu.setAttribute("role", "menu");

  const addAction = (
    label: string,
    action: () => void,
    disabled = false,
  ) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeTableActionMenus(wrapper);
      action();
    });
    menu.append(button);
  };

  const addSeparator = () => {
    const separator = document.createElement("span");
    separator.className = "cm-typora-table-menu-separator";
    menu.append(separator);
  };

  const bodyLineIndex = Math.max(2, position.sourceLineIndex);
  addAction("Insert Row Above", () =>
    applyTableOperation(wrapper, block, (lines) =>
      insertTableRow(lines, bodyLineIndex, position.columnIndex),
    ));
  addAction("Insert Row Below", () =>
    applyTableOperation(wrapper, block, (lines) =>
      insertTableRow(lines, bodyLineIndex + 1, position.columnIndex),
    ));
  addAction("Insert Column Left", () =>
    applyTableOperation(wrapper, block, (lines) =>
      insertTableColumn(lines, position.columnIndex),
    ));
  addAction("Insert Column Right", () =>
    applyTableOperation(wrapper, block, (lines) =>
      insertTableColumn(lines, position.columnIndex + 1),
    ));
  addSeparator();
  addAction("Delete Row", () =>
    applyTableOperation(wrapper, block, (lines) =>
      deleteTableRow(lines, position.sourceLineIndex),
    ), position.sourceLineIndex < 2);
  addAction("Delete Column", () =>
    applyTableOperation(wrapper, block, (lines) =>
      deleteTableColumn(lines, position.columnIndex),
    ));

  document.body.append(menu);

  const anchorRect = anchorElement.getBoundingClientRect();
  positionTablePortalMenu(menu, anchorRect.left, anchorRect.bottom + 4);

  const closeOnOutsidePointer = (event: PointerEvent) => {
    if (event.target instanceof Node && menu.contains(event.target)) {
      return;
    }
    closeTableActionMenus(wrapper);
    document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  };

  window.requestAnimationFrame(() => {
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
  });
}

function positionTablePortalMenu(menu: HTMLElement, left: number, top: number): void {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - menu.offsetWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - menu.offsetHeight - margin);
  menu.style.left = `${Math.min(Math.max(margin, left), maxLeft)}px`;
  menu.style.top = `${Math.min(Math.max(margin, top), maxTop)}px`;
}

function closeTableActionMenus(wrapper: HTMLElement) {
  void wrapper;
  for (const menu of document.querySelectorAll(".cm-typora-table-menu, .cm-typora-table-size-menu")) {
    menu.remove();
  }
}

function applyTableOperation(
  wrapper: HTMLElement,
  block: PreviewBlock,
  operation: (lines: string[]) => string[],
) {
  const nextRaw = operation(block.raw.split(/\r?\n/)).join("\n");
  applyTableEdit(wrapper, block, nextRaw);
}

function applyTableEdit(
  wrapper: HTMLElement,
  block: PreviewBlock,
  nextRaw: string,
) {
  const view = EditorView.findFromDOM(wrapper);
  if (!view) {
    return;
  }

  const scrollDOM = view.scrollDOM;
  const scrollTop = scrollDOM.scrollTop;
  const scrollLeft = scrollDOM.scrollLeft;
  view.dispatch({
    changes: {
      from: block.from,
      to: block.to,
      insert: nextRaw,
    },
    scrollIntoView: false,
    userEvent: "input.table",
  });
  scrollDOM.scrollTop = scrollTop;
  scrollDOM.scrollLeft = scrollLeft;
}

function updateMarkdownTableCell(
  rawTable: string,
  sourceLineIndex: number,
  columnIndex: number,
  nextValue: string,
): string {
  const lines = rawTable.split(/\r?\n/);
  const line = lines[sourceLineIndex];
  if (!line || !isTableRowLine(line)) {
    return rawTable;
  }

  const cells = parseTableCells(line);
  while (cells.length <= columnIndex) {
    cells.push("");
  }

  cells[columnIndex] = escapeMarkdownTableCell(nextValue);
  lines[sourceLineIndex] = serializeMarkdownTableRow(cells);
  return lines.join("\n");
}

function focusTableCellAfterCommit(
  wrapper: HTMLElement,
  blockFrom: number,
  focusIndex: number,
) {
  if (focusIndex < 0) {
    return;
  }

  const view = EditorView.findFromDOM(wrapper);
  if (!view) {
    return;
  }

  const focusCell = () => {
    const nextWrapper = view.dom.querySelector<HTMLElement>(
      `.cm-typora-table-preview[data-markdown-block-from="${blockFrom}"]`,
    );
    const nextCell = nextWrapper?.querySelector<HTMLElement>(
      `[data-table-focus-index="${focusIndex}"]`,
    );
    if (!nextCell) {
      return;
    }

    nextCell.focus();
    placeCaretAtEnd(nextCell);
  };

  window.requestAnimationFrame(() => {
    focusCell();
    window.requestAnimationFrame(focusCell);
  });
}

function serializeMarkdownTableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function insertTableRow(
  lines: string[],
  lineIndex: number,
  focusColumn: number,
): string[] {
  const columnCount = tableColumnCount(lines);
  const row = Array.from({ length: columnCount }, (_, index) =>
    index === focusColumn ? "" : "",
  );
  const nextLines = [...lines];
  nextLines.splice(Math.max(2, Math.min(lineIndex, nextLines.length)), 0, serializeMarkdownTableRow(row));
  return nextLines;
}

function insertTableColumn(lines: string[], columnIndex: number): string[] {
  const columnCount = tableColumnCount(lines);
  const insertAt = Math.max(0, Math.min(columnIndex, columnCount));
  return lines.map((line, lineIndex) => {
    if (!isTableRowLine(line)) {
      return line;
    }
    const cells = parseTableCells(line);
    while (cells.length < columnCount) {
      cells.push("");
    }
    cells.splice(insertAt, 0, lineIndex === 1 ? "---" : "");
    return serializeMarkdownTableRow(cells);
  });
}

function deleteTableRow(lines: string[], lineIndex: number): string[] {
  if (lineIndex < 2 || lineIndex >= lines.length) {
    return lines;
  }
  return lines.filter((_, index) => index !== lineIndex);
}

function deleteTableColumn(lines: string[], columnIndex: number): string[] {
  const columnCount = tableColumnCount(lines);
  if (columnCount <= 1) {
    return lines;
  }
  const deleteAt = Math.max(0, Math.min(columnIndex, columnCount - 1));
  return lines.map((line) => {
    if (!isTableRowLine(line)) {
      return line;
    }
    const cells = parseTableCells(line);
    while (cells.length < columnCount) {
      cells.push("");
    }
    cells.splice(deleteAt, 1);
    return serializeMarkdownTableRow(cells);
  });
}

function prettifyMarkdownTable(lines: string[]): string[] {
  const rows = lines.map((line) => isTableRowLine(line) ? parseTableCells(line) : []);
  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const alignments = parseTableAlignments(lines[1] ?? "", columnCount);
  const widths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(
      3,
      ...rows.map((row) => row[columnIndex]?.length ?? 0),
    ),
  );

  return lines.map((line, lineIndex) => {
    if (!isTableRowLine(line)) {
      return line;
    }

    if (lineIndex === 1) {
      return `| ${widths.map((width, index) =>
        serializeTableAlignmentCell(alignments[index] ?? "default", width),
      ).join(" | ")} |`;
    }

    const cells = parseTableCells(line);
    while (cells.length < columnCount) {
      cells.push("");
    }
    return `| ${cells.map((cell, index) => cell.padEnd(widths[index], " ")).join(" | ")} |`;
  });
}

function setTableColumnAlignment(
  lines: string[],
  columnIndex: number,
  alignment: TableAlignment,
): string[] {
  if (lines.length < 2) {
    return lines;
  }

  const columnCount = tableColumnCount(lines);
  const alignments = parseTableAlignments(lines[1] ?? "", columnCount);
  const targetColumn = Math.max(0, Math.min(columnIndex, columnCount - 1));
  alignments[targetColumn] = alignment;
  const separatorCells = Array.from({ length: columnCount }, (_, index) =>
    serializeTableAlignmentCell(alignments[index] ?? "default"),
  );

  const nextLines = [...lines];
  nextLines[1] = serializeMarkdownTableRow(separatorCells);
  return nextLines;
}

function resizeMarkdownTable(
  lines: string[],
  totalRowCount: number,
  columnCount: number,
): string[] {
  const rows = lines.filter(isTableRowLine).map(parseTableCells);
  const headers = rows[0] ?? [];
  const alignments = parseTableAlignments(lines[1] ?? "", columnCount);
  const nextLines: string[] = [];

  const normalizeRow = (row: string[] | undefined, fallback: string[] = []) => {
    const cells = [...(row ?? fallback)];
    while (cells.length < columnCount) {
      cells.push("");
    }
    return cells.slice(0, columnCount);
  };

  nextLines.push(serializeMarkdownTableRow(normalizeRow(headers)));
  nextLines.push(serializeMarkdownTableRow(
    Array.from({ length: columnCount }, (_, index) =>
      serializeTableAlignmentCell(alignments[index] ?? "default"),
    ),
  ));

  const bodyRowCount = Math.max(0, totalRowCount - 1);
  for (let rowIndex = 0; rowIndex < bodyRowCount; rowIndex += 1) {
    nextLines.push(serializeMarkdownTableRow(normalizeRow(rows[rowIndex + 2])));
  }

  return nextLines;
}

function tableColumnCount(lines: string[]): number {
  return Math.max(
    1,
    ...lines
      .filter(isTableRowLine)
      .map((line) => parseTableCells(line).length),
  );
}

class MermaidPreviewWidget extends WidgetType {
  constructor(private readonly block: PreviewBlock) {
    super();
  }

  eq(other: MermaidPreviewWidget): boolean {
    return other.block.id === this.block.id && other.block.source === this.block.source;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-diagram-preview";
    markMarkdownPreviewBlock(wrapper, this.block, "mermaid-block");
    allowEditorVerticalScroll(wrapper);

    const toolbar = document.createElement("div");
    toolbar.className = "cm-typora-diagram-toolbar";

    const title = document.createElement("span");
    title.textContent = "Mermaid";

    const editButton = createDiagramIconButton(
      "Edit Source",
      "M4 14.25V17h2.75L15.1 8.65l-2.75-2.75L4 14.25Zm12.35-8.85a.95.95 0 0 0 0-1.35l-1.4-1.4a.95.95 0 0 0-1.35 0l-1.1 1.1 2.75 2.75 1.1-1.1Z",
    );
    editButton.addEventListener("click", () => revealSource(wrapper, this.block));

    const pngButton = createDiagramIconButton(
      "Export PNG",
      "M4 4.5A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5v-11ZM7.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM5.5 14.5l2.8-3.5a.75.75 0 0 1 1.15-.03L11 12.75l1.8-2.25a.75.75 0 0 1 1.17.02L15.5 13v1.5h-10Z",
    );
    pngButton.addEventListener("click", () => {
      exportDiagramAsPng(content, this.block.id);
    });
    const svgButton = createDiagramIconButton(
      "Export SVG",
      "M5 3.5h10A1.5 1.5 0 0 1 16.5 5v10A1.5 1.5 0 0 1 15 16.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5Zm2 4.25h6V9H7V7.75Zm0 3h6V12H7v-1.25Zm0 3h4V15H7v-1.25Z",
    );
    svgButton.addEventListener("click", () => {
      exportDiagramAsSvg(content, this.block.id);
    });
    const copyButton = createDiagramIconButton(
      "Copy Source",
      "M6 5.5A1.5 1.5 0 0 1 7.5 4h7A1.5 1.5 0 0 1 16 5.5v7A1.5 1.5 0 0 1 14.5 14h-7A1.5 1.5 0 0 1 6 12.5v-7ZM3 8.5A1.5 1.5 0 0 1 4.5 7H5v5.5A2.5 2.5 0 0 0 7.5 15H13v.5A1.5 1.5 0 0 1 11.5 17h-7A1.5 1.5 0 0 1 3 15.5v-7Z",
    );
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.block.source);
    });

    toolbar.append(title, editButton, pngButton, svgButton, copyButton);

    const content = document.createElement("div");
    content.className = "cm-typora-diagram-content";
    content.textContent = "Rendering Mermaid diagram...";

    wrapper.append(toolbar, content);
    scheduleEditorMeasureFromDom(wrapper);

    void renderMermaidPreview(this.block.source, content);

    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class PlantUmlPreviewWidget extends WidgetType {
  constructor(private readonly block: PreviewBlock) {
    super();
  }

  eq(other: PlantUmlPreviewWidget): boolean {
    return other.block.id === this.block.id && other.block.source === this.block.source;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-diagram-preview cm-typora-plantuml-preview";
    markMarkdownPreviewBlock(wrapper, this.block, "plantuml-block");
    allowEditorVerticalScroll(wrapper);

    const toolbar = document.createElement("div");
    toolbar.className = "cm-typora-diagram-toolbar";

    const title = document.createElement("span");
    title.textContent = "PlantUML";

    const editButton = createDiagramIconButton(
      "Edit Source",
      "M4 14.25V17h2.75L15.1 8.65l-2.75-2.75L4 14.25Zm12.35-8.85a.95.95 0 0 0 0-1.35l-1.4-1.4a.95.95 0 0 0-1.35 0l-1.1 1.1 2.75 2.75 1.1-1.1Z",
    );
    editButton.addEventListener("click", () => revealSource(wrapper, this.block));

    const pngButton = createDiagramIconButton(
      "Export PNG",
      "M4 4.5A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5v-11ZM7.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM5.5 14.5l2.8-3.5a.75.75 0 0 1 1.15-.03L11 12.75l1.8-2.25a.75.75 0 0 1 1.17.02L15.5 13v1.5h-10Z",
    );
    pngButton.addEventListener("click", () => {
      exportDiagramAsPng(content, this.block.id);
    });
    const svgButton = createDiagramIconButton(
      "Export SVG",
      "M5 3.5h10A1.5 1.5 0 0 1 16.5 5v10A1.5 1.5 0 0 1 15 16.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5Zm2 4.25h6V9H7V7.75Zm0 3h6V12H7v-1.25Zm0 3h4V15H7v-1.25Z",
    );
    svgButton.addEventListener("click", () => {
      exportDiagramAsSvg(content, this.block.id);
    });

    const copyButton = createDiagramIconButton(
      "Copy Source",
      "M6 5.5A1.5 1.5 0 0 1 7.5 4h7A1.5 1.5 0 0 1 16 5.5v7A1.5 1.5 0 0 1 14.5 14h-7A1.5 1.5 0 0 1 6 12.5v-7ZM3 8.5A1.5 1.5 0 0 1 4.5 7H5v5.5A2.5 2.5 0 0 0 7.5 15H13v.5A1.5 1.5 0 0 1 11.5 17h-7A1.5 1.5 0 0 1 3 15.5v-7Z",
    );
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.block.source);
    });

    toolbar.append(title, editButton, pngButton, svgButton, copyButton);

    const content = document.createElement("div");
    content.className = "cm-typora-diagram-content";
    content.textContent = "Rendering PlantUML diagram...";

    const privacyNote = document.createElement("p");
    privacyNote.textContent =
      "Rendered by the configured PlantUML server. Diagram text may be sent to that server.";

    wrapper.append(toolbar, content, privacyNote);
    scheduleEditorMeasureFromDom(wrapper);

    void renderPlantUmlPreview(this.block.source, content);

    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function createDiagramIconButton(label: string, pathData: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-typora-diagram-icon-button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 20 20"><path d="${pathData}"/></svg>`;
  return button;
}

function exportDiagramAsSvg(contentElement: HTMLElement, diagramId: string): void {
  const svg = findRenderedSvg(contentElement);
  if (svg) exportSvgElementAsSvg(svg, diagramId);
}

function exportDiagramAsPng(contentElement: HTMLElement, diagramId: string): void {
  const svg = findRenderedSvg(contentElement);
  if (svg) exportSvgElementAsPng(svg, diagramId);
}

async function renderPlantUmlPreview(
  source: string,
  content: HTMLElement,
) {
  const cachedResult = plantUmlRenderCache.get(source);
  if (cachedResult?.svgContent) {
    content.innerHTML = cachedResult.svgContent;
    scheduleEditorMeasureFromDom(content);
    return;
  }

  if (cachedResult?.error) {
    content.textContent = cachedResult.error;
    content.classList.add("cm-typora-diagram-error");
    scheduleEditorMeasureFromDom(content);
    return;
  }

  try {
    const response = await fetch(`${plantUmlServerUrl}${encodePlantUmlHex(source)}`);
    if (!response.ok) {
      throw new Error(`PlantUML server returned ${response.status}.`);
    }

    const svgContent = await response.text();
    if (!svgContent.includes("<svg")) {
      throw new Error("PlantUML server did not return SVG content.");
    }

    plantUmlRenderCache.set(source, {
      svgContent,
    });
    content.innerHTML = svgContent;
    scheduleEditorMeasureFromDom(content);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : `PlantUML render failed: ${String(error)}`;
    plantUmlRenderCache.set(source, {
      error: message,
    });
    content.classList.add("cm-typora-diagram-error");
    content.textContent = message;
    scheduleEditorMeasureFromDom(content);
  }
}

function encodePlantUmlHex(source: string): string {
  const bytes = new TextEncoder().encode(source);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `~h${hex}`;
}

async function renderMermaidPreview(
  source: string,
  content: HTMLElement,
) {
  const cachedResult = mermaidRenderCache.get(source);
  if (cachedResult?.svgContent) {
    content.innerHTML = cachedResult.svgContent;
    scheduleEditorMeasureFromDom(content);
    return;
  }

  if (cachedResult?.error) {
    content.textContent = cachedResult.error;
    content.classList.add("cm-typora-diagram-error");
    scheduleEditorMeasureFromDom(content);
    return;
  }

  try {
    initializeMermaid();
    const result = await mermaid.render(diagramIdForSource(source), source);
    mermaidRenderCache.set(source, {
      svgContent: result.svg,
    });
    content.innerHTML = result.svg;
    scheduleEditorMeasureFromDom(content);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Mermaid render failed: ${String(error)}`;
    mermaidRenderCache.set(source, {
      error: message,
    });
    content.classList.add("cm-typora-diagram-error");
    content.textContent = message;
    scheduleEditorMeasureFromDom(content);
  }
}

class CodeFenceLanguageWidget extends WidgetType {
  constructor(private readonly fenceInfo: CodeFenceInfo) {
    super();
  }

  eq(other: CodeFenceLanguageWidget): boolean {
    return (
      other.fenceInfo.lineFrom === this.fenceInfo.lineFrom &&
      other.fenceInfo.language === this.fenceInfo.language
    );
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-code-language";

    const listId = `polarbear-code-languages-${this.fenceInfo.lineFrom}`;
    const input = document.createElement("input");
    input.className = "cm-typora-code-language-input";
    input.setAttribute("aria-label", "Code block language");
    input.setAttribute("list", listId);
    input.spellcheck = false;
    input.value = this.fenceInfo.language || "text";

    const dataList = document.createElement("datalist");
    dataList.id = listId;

    for (const language of supportedCodeLanguages) {
      const option = document.createElement("option");
      option.value = language;
      dataList.append(option);
    }

    const commitLanguage = () => {
      const view = EditorView.findFromDOM(wrapper);
      if (!view) {
        return;
      }

      const rawLanguage = input.value.trim();
      const nextLanguage = rawLanguage === "text" ? "" : rawLanguage;
      const currentLine = view.state.doc.lineAt(this.fenceInfo.lineFrom);
      const currentFence = parseCodeFenceLine(
        currentLine.from,
        currentLine.to,
        currentLine.text,
      );
      if (!currentFence || currentFence.language === nextLanguage) {
        return;
      }

      const scrollDOM = view.scrollDOM;
      const scrollTop = scrollDOM.scrollTop;
      const scrollLeft = scrollDOM.scrollLeft;
      const restoreScroll = () => {
        scrollDOM.scrollTop = scrollTop;
        scrollDOM.scrollLeft = scrollLeft;
      };
      const marker = view.state.sliceDoc(
        currentFence.lineFrom,
        currentFence.markerTo,
      );
      view.dispatch({
        changes: {
          from: currentFence.lineFrom,
          to: currentFence.lineTo,
          insert: `${marker}${nextLanguage}`,
        },
        scrollIntoView: false,
      });
      restoreScroll();
      window.requestAnimationFrame(() => {
        view.focus();
        restoreScroll();
        window.requestAnimationFrame(restoreScroll);
      });
    };

    wrapper.addEventListener("mousedown", (event) => event.stopPropagation());
    wrapper.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", commitLanguage);
    input.addEventListener("blur", commitLanguage);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitLanguage();
        input.blur();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        input.value = this.fenceInfo.language || "text";
        input.blur();
      }
    });

    wrapper.append(input, dataList);
    return wrapper;
  }

  ignoreEvent(event: Event): boolean {
    const target = event.target;
    return target instanceof HTMLElement && Boolean(
      target.closest("input, button, select, .cm-typora-code-language"),
    );
  }
}

class HiddenCodeFenceWidget extends WidgetType {
  toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-typora-code-fence-closing-hidden";
    return element;
  }
}

class MarkdownImagePreviewWidget extends WidgetType {
  constructor(
    private readonly params: {
      activeFileId: string;
      alt: string;
      blockId: string;
      from: number;
      src: string;
      to: number;
      workspaceRoot: string;
    },
  ) {
    super();
  }

  eq(other: MarkdownImagePreviewWidget): boolean {
    return (
      other.params.src === this.params.src &&
      other.params.alt === this.params.alt &&
      other.params.activeFileId === this.params.activeFileId &&
      other.params.blockId === this.params.blockId &&
      other.params.from === this.params.from &&
      other.params.to === this.params.to &&
      other.params.workspaceRoot === this.params.workspaceRoot
    );
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("figure");
    wrapper.className = "cm-typora-image-preview";
    wrapper.dataset.markdownBlockId = this.params.blockId;
    wrapper.dataset.markdownBlockType = "image";
    wrapper.classList.add("markdown-image-block");
    wrapper.title = "Click to edit image Markdown source";
    allowEditorVerticalScroll(wrapper);
    wrapper.addEventListener("mousedown", (event) => {
      event.preventDefault();
      revealSource(wrapper, {
        from: this.params.from,
      });
    });

    const image = document.createElement("img");
    image.alt = this.params.alt || "image";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("load", () => scheduleEditorMeasureFromDom(wrapper));
    image.addEventListener("error", () => scheduleEditorMeasureFromDom(wrapper));

    const caption = document.createElement("figcaption");
    caption.textContent = this.params.src;

    wrapper.append(image, caption);

    if (isRemoteOrDataImage(this.params.src)) {
      image.src = this.params.src;
      scheduleEditorMeasureFromDom(wrapper);
      return wrapper;
    }

    if (!this.params.workspaceRoot || !this.params.activeFileId) {
      wrapper.classList.add("cm-typora-image-error");
      caption.textContent = `Image preview needs a saved workspace file: ${this.params.src}`;
      scheduleEditorMeasureFromDom(wrapper);
      return wrapper;
    }

    void resolveMarkdownAsset({
      workspaceRef: this.params.workspaceRoot,
      markdownRelativePath: this.params.activeFileId,
      assetSrc: this.params.src,
    })
      .then((asset) => {
        if (!asset.exists || !asset.assetUrl) {
          wrapper.classList.add("cm-typora-image-error");
          caption.textContent = asset.error || `Image not found: ${this.params.src}`;
          scheduleEditorMeasureFromDom(wrapper);
          return;
        }

        image.src = asset.assetUrl;
        caption.textContent = this.params.alt || this.params.src;
        scheduleEditorMeasureFromDom(wrapper);
      })
      .catch((error: unknown) => {
        wrapper.classList.add("cm-typora-image-error");
        caption.textContent = error instanceof Error ? error.message : String(error);
        scheduleEditorMeasureFromDom(wrapper);
      });

    scheduleEditorMeasureFromDom(wrapper);
    return wrapper;
  }
}
