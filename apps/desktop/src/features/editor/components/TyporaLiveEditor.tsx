import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { search } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { APP_EVENTS } from "../../../shared/events/appEvents";
import { translateCurrent } from "../../../shared/i18n/translate";
import { useUserSettings } from "../../../shared/settings/useUserSettings";
import type { MarkdownEditorView } from "./MarkdownEditor";
import { clearLiveEditorViewportSizing, sizeLiveEditorViewport } from "../liveEditorViewport";
import { collectLiveDebugState, copyLiveDebugText, createInitialLiveDebugState, describeDebugTarget, formatLiveDebugState, isAppCanvasTransformActive, isLiveDebugEnabled, isLiveDebugPanelEnabled, isLiveScrollDebugEnabled, type LiveDebugState, writeLiveDebugOverlay } from "../liveEditorDebug";
import { useCodeFenceLanguageHover } from "../hooks/useCodeFenceLanguageHover";
import { createRichMarkdownCopyExtension } from "../richMarkdownClipboard";
import { createMermaidPasteExtension } from "../mermaidPasteExtension";
import { liveDocumentSelection } from "../liveDocumentSelection";
import { createImagePasteExtension, type ImagePasteHandler } from "../imagePasteExtension";
import { createLinkClickExtension, preserveLargeEnterScrollJumpExtension, trimSingleLineBreakSelectionExtension } from "../codeMirrorInteractionExtensions";
import { tableLayoutExtension } from "../table/tableLayoutState";
import { typoraLiveDecorations, typoraLiveKeymap } from "../liveMarkdownDecorations";

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
  onClipboardStatus?: (message: string) => void;
  onEditorReady?: (editorView: MarkdownEditorView | null) => void;
  onImageDrop?: ImageDropHandler;
  onImagePaste?: ImagePasteHandler;
  workspaceRoot: string;
};

export function TyporaLiveEditor({
  activeFileId,
  markdown,
  markdownContent,
  onChange,
  onMarkdownChange,
  onClipboardStatus,
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
  const [, setDebugRevision] = useState(0);
  const liveDebugEnabled = isLiveDebugEnabled();
  const liveDebugPanelEnabled = isLiveDebugPanelEnabled();
  const [debugState, setDebugState] = useState<LiveDebugState>(() => createInitialLiveDebugState());
  const userSettings = useUserSettings();

  useEffect(() => {
    const handleDebugChange = () => setDebugRevision((revision) => revision + 1);
    window.addEventListener(APP_EVENTS.debugChanged, handleDebugChange);
    return () => window.removeEventListener(APP_EVENTS.debugChanged, handleDebugChange);
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
      typoraLiveKeymap(userSettings.keybindings),
      tableLayoutExtension(JSON.stringify([workspaceRoot, activeFileId])),
      createRichMarkdownCopyExtension(onClipboardStatus),
      createMermaidPasteExtension(onClipboardStatus),
      liveDocumentSelection,
      trimSingleLineBreakSelectionExtension,
      preserveLargeEnterScrollJumpExtension,
      markdownLanguage(),
      search({ top: true }),
      createLinkClickExtension(),
      createImagePasteExtension(stableImagePasteHandler),
      typoraLiveDecorations({
        activeFileId,
        keybindingOverrides: userSettings.keybindings,
        workspaceRoot,
      }),
      EditorView.lineWrapping,
    ],
    [activeFileId, onClipboardStatus, stableImagePasteHandler, userSettings.keybindings, workspaceRoot],
  );

  useCodeFenceLanguageHover(paneRef);

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
        const didSize = sizeLiveEditorViewport(pane);
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
            const didRetrySize = sizeLiveEditorViewport(pane);
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
    window.addEventListener(APP_EVENTS.appCanvasZoomSettled, syncLiveScrollArea);
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
      window.removeEventListener(APP_EVENTS.appCanvasZoomSettled, syncLiveScrollArea);
      window.removeEventListener("resize", syncLiveScrollArea);
      window.visualViewport?.removeEventListener("resize", syncLiveScrollArea);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      clearLiveEditorViewportSizing(pane);
    };
  }, [liveDebugEnabled, reportLiveDebug]);

  useEffect(() => {
    if (!liveDebugEnabled || !isLiveScrollDebugEnabled()) {
      return undefined;
    }

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
  }, [liveDebugEnabled, reportLiveDebug]);

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
            <strong>{translateCurrent("debug.scrollTitle")}</strong>
            <button
              type="button"
              onClick={() => {
                void copyLiveDebugText(formatLiveDebugState(debugState));
              }}
            >
              {translateCurrent("common.copy")}
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
            sizeLiveEditorViewport(paneRef.current);
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
