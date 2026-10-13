import { useEffect, useRef, useState, type RefObject, type PointerEvent } from "react";
import { syntaxTree } from "@codemirror/language";
import type { MarkdownEditorView } from "../editor/components/MarkdownEditor";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { useEventCallback } from "../../shared/hooks/useEventCallback";
import { useUserSettings } from "../../shared/settings/useUserSettings";
import { normalizeReadingSelection, readingContext, READING_SELECTION_DELAY_MS, MAX_CAPTURE_SENTENCE_LENGTH } from "./readingSelection";
import { VocabPopover, type ReadingTarget } from "./VocabPopover";

type Options = {
  editor: RefObject<MarkdownEditorView | null>; markdown: string; filePath: string | null;
  title: string; preview: boolean; onStatus: (message: string) => void;
};

export function useVocabReading(options: Options) {
  const { t } = useI18n();
  const settings = useUserSettings();
  const [target, setTarget] = useState<ReadingTarget | null>(null);
  const pointerSelecting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const returnFocus = useRef<HTMLElement | null>(null);
  const nativeRange = useRef<Range | null>(null);
  const clear = useEventCallback(() => { clearTimeout(timer.current); setTarget(null); });

  const snapshot = useEventCallback((): ReadingTarget | null => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    const inDocument = element?.closest(".editor-workspace");
    const range = inDocument && selection?.rangeCount ? selection.getRangeAt(0) : null;
    const view = options.editor.current;
    const cmRange = view?.state.selection.main;
    const useDom = range && !range.collapsed && (options.preview || !view?.contentDOM.contains(node ?? null));
    if (useDom && (!inDocument?.contains(selection?.focusNode ?? null)
      || element?.closest("pre, code, button, input, textarea, select, .cm-typora-diagram-preview"))) return null;
    if (!useDom && view && cmRange) {
      let current = syntaxTree(view.state).resolveInner(cmRange.from, 1);
      while (current) {
        if (/^(FencedCode|CodeBlock|CodeText|InlineCode)$/.test(current.name)) return null;
        if (!current.parent) break;
        current = current.parent;
      }
    }
    const raw = useDom ? selection?.toString() ?? "" : cmRange && view ? view.state.sliceDoc(cmRange.from, cmRange.to) : "";
    const term = normalizeReadingSelection(raw);
    if (!term) return null;
    nativeRange.current = range?.cloneRange() ?? null;
    const context = useDom ? {
      sentence: element?.closest("p, li, td, th, blockquote")?.textContent?.trim().slice(0, MAX_CAPTURE_SENTENCE_LENGTH) ?? raw.slice(0, MAX_CAPTURE_SENTENCE_LENGTH),
      heading: "", line: null,
    } : readingContext(options.markdown, cmRange?.from ?? 0, cmRange?.to ?? 0);
    const rect = range?.getBoundingClientRect();
    const coords = view && cmRange ? view.coordsAtPos(cmRange.to) : null;
    return {
      rect: { left: rect?.width ? rect.left : coords?.left ?? 24, top: rect?.width ? rect.top : coords?.top ?? 60,
        bottom: rect?.width ? rect.bottom : coords?.bottom ?? 80 },
      capture: { requestId: crypto.randomUUID(), selectedText: term, senseUid: null,
        ...context, title: options.title.slice(0, 300), filePath: options.filePath },
    };
  });

  const open = useEventCallback(() => {
    const next = snapshot();
    if (!next) { options.onStatus(t("vocab.selectFirst")); return; }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTarget(next);
  });
  const schedule = useEventCallback(() => {
    if (!settings.selectionTranslation || pointerSelecting.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = snapshot();
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setTarget((current) => current?.capture.selectedText === next?.capture.selectedText && current?.capture.sentence === next?.capture.sentence ? current : next);
    }, READING_SELECTION_DELAY_MS);
  });
  useEffect(() => {
    if (!settings.selectionTranslation) clear();
  }, [settings.selectionTranslation, clear]);
  useEffect(() => { clear(); }, [options.filePath, options.title, options.markdown, clear]);
  useEffect(() => {
    const release = () => { if (pointerSelecting.current) { pointerSelecting.current = false; schedule(); } };
    const cancel = () => { pointerSelecting.current = false; clear(); };
    const input = (event: Event) => { if ((event.target as Element | null)?.closest(".editor-workspace")) clear(); };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    document.addEventListener("input", input);
    return () => { clearTimeout(timer.current); window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur", cancel); document.removeEventListener("input", input); };
  }, [clear, schedule]);
  const close = (restoreFocus: boolean) => {
    clear();
    if (!restoreFocus) return;
    returnFocus.current?.focus({ preventScroll: true });
    const range = nativeRange.current;
    if (range?.startContainer.isConnected && range.endContainer.isConnected) {
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    }
  };
  return {
    open, controls: () => target && <VocabPopover key={target.capture.requestId} target={target} onClose={close} />,
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0 || (event.target as Element).closest("button, input, textarea, select, pre, code, .cm-typora-diagram-preview")) return;
      clear(); pointerSelecting.current = true;
    },
    onPointerUp: () => { if (pointerSelecting.current) { pointerSelecting.current = false; schedule(); } },
    onScroll: clear,
  };
}
