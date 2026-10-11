import { useLayoutEffect, useRef, useState, type RefObject, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { MarkdownEditorView } from "../editor/components/MarkdownEditor";
import type { ExecuteAppCommand } from "../../shared/commands/appCommandTypes";
import { APP_COMMANDS } from "../../shared/commands/appCommandIds";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { useEventCallback } from "../../shared/hooks/useEventCallback";
import { normalizeReadingSelection, readingContext } from "./readingSelection";
import { VocabPopover, type ReadingTarget } from "./VocabPopover";

type Options = {
  editor: RefObject<MarkdownEditorView | null>;
  markdown: string;
  filePath: string | null;
  title: string;
  preview: boolean;
  onStatus: (message: string) => void;
};

export function useVocabReading(options: Options) {
  const { t } = useI18n();
  const [target, setTarget] = useState<ReadingTarget | null>(null);
  const [suggestion, setSuggestion] = useState<ReadingTarget | null>(null);
  const pending = useRef<ReadingTarget | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const nativeRange = useRef<Range | null>(null);
  const suggestionButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const button = suggestionButton.current;
    if (!button || !suggestion || target) return;
    const place = () => {
      const bounds = button.getBoundingClientRect();
      button.style.left = `${Math.max(12, Math.min(suggestion.rect.left, window.innerWidth - bounds.width - 12))}px`;
      button.style.top = `${Math.max(12, Math.min(suggestion.rect.bottom + 6, window.innerHeight - bounds.height - 12))}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [suggestion, target, t]);

  const snapshot = useEventCallback((): ReadingTarget | null => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    const inDocument = element?.closest(".editor-workspace");
    const range = inDocument && selection?.rangeCount ? selection.getRangeAt(0) : null;
    const view = options.editor.current;
    const cmRange = view?.state.selection.main;
    const useDom = range && !range.collapsed && (options.preview || !view?.contentDOM.contains(node ?? null));
    const raw = useDom ? selection?.toString() ?? "" : cmRange && view ? view.state.sliceDoc(cmRange.from, cmRange.to) : "";
    const term = normalizeReadingSelection(raw);
    if (!term) return null;
    nativeRange.current = range?.cloneRange() ?? null;
    const context = useDom ? {
      sentence: element?.closest("p, li, td, th, blockquote")?.textContent?.trim().slice(0, 2000) ?? raw,
      heading: "", line: null,
    } : readingContext(options.markdown, cmRange?.from ?? 0, cmRange?.to ?? 0);
    const rect = range?.getBoundingClientRect();
    const coords = view && cmRange ? view.coordsAtPos(cmRange.to) : null;
    return {
      rect: { left: rect?.width ? rect.left : coords?.left ?? 24, bottom: rect?.width ? rect.bottom : coords?.bottom ?? 80 },
      capture: { requestId: crypto.randomUUID(), selectedText: term, senseUid: null,
        ...context, title: options.title.slice(0, 300), filePath: options.filePath },
    };
  });

  const open = useEventCallback(() => {
    const next = pending.current ?? snapshot();
    pending.current = null;
    setSuggestion(null);
    if (!next) { options.onStatus(t("vocab.selectFirst")); return; }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTarget(next);
  });

  const close = (restoreFocus: boolean) => {
    setTarget(null);
    if (!restoreFocus) return;
    returnFocus.current?.focus({ preventScroll: true });
    const range = nativeRange.current;
    if (range?.startContainer.isConnected && range.endContainer.isConnected) {
      const selection = window.getSelection();
      selection?.removeAllRanges(); selection?.addRange(range);
    }
  };

  const contextMenu = (event: MouseEvent, execute: ExecuteAppCommand) => {
    const next = snapshot();
    if (!next) return;
    event.preventDefault(); event.stopPropagation();
    if (!("__TAURI_INTERNALS__" in window)) { setSuggestion(next); return; }
    void import("@tauri-apps/api/menu").then(async ({ Menu }) => {
      const menu = await Menu.new({ items: [{ id: APP_COMMANDS.vocabLookup, text: t("vocab.lookup"),
        action: () => { pending.current = next; execute(APP_COMMANDS.vocabLookup, { commandSource: "contextMenu" }); } },
        { item: "Copy" }] });
      try { await menu.popup(); } finally { await menu.close(); }
    }).catch(() => setSuggestion(next));
  };

  const controls = (execute: ExecuteAppCommand) => <>
    {suggestion && !target && createPortal(<button ref={suggestionButton} type="button" className="vocab-selection-action"
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => { pending.current = suggestion; execute(APP_COMMANDS.vocabLookup, { commandSource: "toolbar" }); }}
      title={t("vocab.lookup")}>{t("vocab.readSelection")}</button>, document.body)}
    {target && <VocabPopover key={target.capture.requestId} target={target} onClose={close} />}
  </>;

  return { open, contextMenu, controls,
    onPointerUp: () => { if (!target) setSuggestion(snapshot()); },
    onScroll: () => setSuggestion(null),
  };
}
