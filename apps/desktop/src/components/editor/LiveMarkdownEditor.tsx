import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import MarkdownIt from "markdown-it";
import type { MarkdownEditorView } from "./MarkdownEditor";
import { MarkdownImage } from "./MarkdownImage";
import { MermaidBlock } from "../mermaid/MermaidBlock";
import { PlantUmlBlock } from "../mermaid/PlantUmlBlock";

type MarkdownBlockType =
  | "blank"
  | "blockquote"
  | "code_fence"
  | "diagram"
  | "heading"
  | "horizontal_rule"
  | "image"
  | "list"
  | "math"
  | "paragraph"
  | "table";

type MarkdownBlock = {
  id: string;
  raw: string;
  separator: string;
  start: number;
  end: number;
  type: MarkdownBlockType;
};

type SourceEditingBlock = {
  blockId: string;
  draft: string;
};

type LiveMarkdownEditorProps = {
  activeFileId: string;
  activeFileName: string;
  markdownContent: string;
  onEditorReady?: (editorView: MarkdownEditorView) => void;
  onImagePaste?: ImagePasteHandler;
  onMarkdownChange: (markdownContent: string) => void;
  workspaceRoot: string;
};

type EditableTextBlockKind = "heading" | "paragraph" | "blockquote" | "list";

type MarkdownTable = {
  headers: string[];
  rows: string[][];
};

type ImagePasteHandler = (
  items: DataTransferItemList,
  insertMarkdown?: (markdown: string) => void,
) => void;

type ChangeHistoryKind = "input" | "structural";


export function LiveMarkdownEditor({
  activeFileId,
  activeFileName,
  markdownContent,
  onEditorReady,
  onImagePaste,
  onMarkdownChange,
  workspaceRoot,
}: LiveMarkdownEditorProps) {
  const [sourceEditingBlock, setSourceEditingBlock] =
    useState<SourceEditingBlock | null>(null);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [focusRequestId, setFocusRequestId] = useState<string | null>(null);
  const blocks = useMemo(
    () => parseMarkdownBlocks(markdownContent),
    [markdownContent],
  );
  const markdownRenderer = useMemo(
    () =>
      new MarkdownIt({
        html: false,
        linkify: true,
        typographer: true,
      }),
    [],
  );
  const markdownRef = useRef(markdownContent);
  const blocksRef = useRef(blocks);
  const activeBlockIdRef = useRef<string | null>(null);
  const editableElementRefs = useRef(new Map<string, HTMLElement>());
  const documentElementRef = useRef<HTMLElement | null>(null);
  const allSelectedRef = useRef(false);
  const pendingCommitTimerRef = useRef<number | null>(null);
  const pendingMarkdownCommitRef = useRef<string | null>(null);
  const historyPastRef = useRef<string[]>([]);
  const historyFutureRef = useRef<string[]>([]);
  const inputHistoryOpenRef = useRef(false);

  useEffect(() => {
    markdownRef.current = markdownContent;
  }, [markdownContent]);

  useEffect(() => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    inputHistoryOpenRef.current = false;
    pendingMarkdownCommitRef.current = null;
    if (pendingCommitTimerRef.current !== null) {
      window.clearTimeout(pendingCommitTimerRef.current);
      pendingCommitTimerRef.current = null;
    }
  }, [activeFileId]);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const registerEditableElement = useCallback(
    (blockId: string, element: HTMLElement | null) => {
      if (element) {
        editableElementRefs.current.set(blockId, element);
        return;
      }

      editableElementRefs.current.delete(blockId);
    },
    [],
  );

  const focusBlock = useCallback((blockId: string | null, atStart = false) => {
    if (!blockId) {
      return;
    }

    const applyFocus = () => {
      const registeredElement = editableElementRefs.current.get(blockId);
      const fallbackElement =
        documentElementRef.current?.querySelector<HTMLElement>(
          `[data-block-id="${cssEscapeIdentifier(blockId)}"]`,
        );
      const element = registeredElement ?? fallbackElement ?? null;
      if (!element) {
        return;
      }

      if (document.activeElement !== element) {
        element.focus({ preventScroll: true });
      }

      if (element.isContentEditable) {
        if (atStart) {
          placeCaretAtStart(element);
        } else {
          placeCaretAtEnd(element);
        }
      }
    };

    window.requestAnimationFrame(applyFocus);
    window.setTimeout(applyFocus, 0);
  }, []);

  const focusRelativeBlock = useCallback(
    (blockId: string, direction: -1 | 1) => {
      const currentBlocks = blocksRef.current;
      const currentIndex = currentBlocks.findIndex(
        (block) => block.id === blockId,
      );
      if (currentIndex < 0) {
        return;
      }

      const targetBlock = currentBlocks[currentIndex + direction];
      if (!targetBlock) {
        return;
      }

      activeBlockIdRef.current = targetBlock.id;
      setFocusRequestId(targetBlock.id);
      focusBlock(targetBlock.id, direction > 0);
    },
    [focusBlock],
  );

  const selectDocumentContents = useCallback(() => {
    const documentElement = documentElementRef.current;
    if (!documentElement) {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(documentElement);
    selection.removeAllRanges();
    selection.addRange(range);
    allSelectedRef.current = true;
  }, []);

  const getMarkdownSelection = useCallback(() => {
    const markdown = markdownRef.current;

    if (allSelectedRef.current) {
      return {
        from: 0,
        to: markdown.length,
      };
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      for (const [blockId, element] of editableElementRefs.current.entries()) {
        if (!element) {
          continue;
        }

        const range = selection.getRangeAt(0);
        if (
          element.contains(range.startContainer) &&
          element.contains(range.endContainer)
        ) {
          const block = blocksRef.current.find(
            (candidate) => candidate.id === blockId,
          );
          const offsets = getSelectionOffsetsInside(element);
          if (block && offsets) {
            const prefixLength = editableSourcePrefixLength(block);
            return {
              from: clampNumber(
                block.start + prefixLength + offsets.from,
                0,
                markdown.length,
              ),
              to: clampNumber(
                block.start + prefixLength + offsets.to,
                0,
                markdown.length,
              ),
            };
          }
        }
      }
    }

    const activeBlockId = activeBlockIdRef.current;
    const activeBlock = blocksRef.current.find(
      (block) => block.id === activeBlockId,
    );

    if (activeBlock) {
      return {
        from: clampNumber(activeBlock.end, 0, markdown.length),
        to: clampNumber(activeBlock.end, 0, markdown.length),
      };
    }

    return {
      from: markdown.length,
      to: markdown.length,
    };
  }, []);

  const flushPendingMarkdownCommit = useCallback(() => {
    if (pendingCommitTimerRef.current !== null) {
      window.clearTimeout(pendingCommitTimerRef.current);
      pendingCommitTimerRef.current = null;
    }

    const pendingMarkdown = pendingMarkdownCommitRef.current;
    if (pendingMarkdown === null) {
      return;
    }

    pendingMarkdownCommitRef.current = null;
    onMarkdownChange(pendingMarkdown);
  }, [onMarkdownChange]);

  useEffect(() => {
    return () => {
      flushPendingMarkdownCommit();
    };
  }, [flushPendingMarkdownCommit]);

  const commitMarkdownToParent = useCallback(
    (nextMarkdown: string, immediate: boolean) => {
      if (immediate) {
        if (pendingCommitTimerRef.current !== null) {
          window.clearTimeout(pendingCommitTimerRef.current);
          pendingCommitTimerRef.current = null;
        }
        pendingMarkdownCommitRef.current = null;
        onMarkdownChange(nextMarkdown);
        return;
      }

      pendingMarkdownCommitRef.current = nextMarkdown;
      if (pendingCommitTimerRef.current !== null) {
        return;
      }

      pendingCommitTimerRef.current = window.setTimeout(() => {
        pendingCommitTimerRef.current = null;
        const pendingMarkdown = pendingMarkdownCommitRef.current;
        if (pendingMarkdown === null) {
          return;
        }
        pendingMarkdownCommitRef.current = null;
        onMarkdownChange(pendingMarkdown);
      }, 80);
    },
    [onMarkdownChange],
  );

  const recordHistoryBeforeChange = useCallback(
    (previousMarkdown: string, kind: ChangeHistoryKind) => {
      if (kind === "input") {
        if (inputHistoryOpenRef.current) {
          return;
        }
        inputHistoryOpenRef.current = true;
      } else {
        inputHistoryOpenRef.current = false;
      }

      const historyPast = historyPastRef.current;
      if (historyPast.at(-1) === previousMarkdown) {
        return;
      }

      historyPast.push(previousMarkdown);
      if (historyPast.length > 120) {
        historyPast.shift();
      }
      historyFutureRef.current = [];
    },
    [],
  );

  const applyMarkdownSnapshot = useCallback(
    (snapshot: string) => {
      if (pendingCommitTimerRef.current !== null) {
        window.clearTimeout(pendingCommitTimerRef.current);
        pendingCommitTimerRef.current = null;
      }
      pendingMarkdownCommitRef.current = null;
      inputHistoryOpenRef.current = false;

      const reparsedBlocks = parseMarkdownBlocks(snapshot);
      markdownRef.current = snapshot;
      blocksRef.current = reparsedBlocks;
      onMarkdownChange(snapshot);

      const fallbackBlock =
        reparsedBlocks.find((block) => block.id === activeBlockIdRef.current) ??
        reparsedBlocks.at(-1) ??
        null;
      activeBlockIdRef.current = fallbackBlock?.id ?? null;
      setFocusRequestId(fallbackBlock?.id ?? null);
    },
    [onMarkdownChange],
  );

  const undoMarkdown = useCallback(() => {
    const previousMarkdown = historyPastRef.current.pop();
    if (previousMarkdown === undefined) {
      return;
    }

    const currentMarkdown = markdownRef.current;
    if (currentMarkdown !== previousMarkdown) {
      historyFutureRef.current.push(currentMarkdown);
    }
    applyMarkdownSnapshot(previousMarkdown);
  }, [applyMarkdownSnapshot]);

  const redoMarkdown = useCallback(() => {
    const nextMarkdown = historyFutureRef.current.pop();
    if (nextMarkdown === undefined) {
      return;
    }

    const currentMarkdown = markdownRef.current;
    if (currentMarkdown !== nextMarkdown) {
      historyPastRef.current.push(currentMarkdown);
    }
    applyMarkdownSnapshot(nextMarkdown);
  }, [applyMarkdownSnapshot]);

  const liveEditorView = useMemo<MarkdownEditorView>(
    () => ({
      focus: () => {
        focusBlock(
          activeBlockIdRef.current ?? blocksRef.current.at(-1)?.id ?? null,
        );
      },
      dispatch: (transaction) => {
        const currentMarkdown = markdownRef.current;
        let nextMarkdown = currentMarkdown;

        if (transaction.changes) {
          nextMarkdown =
            currentMarkdown.slice(0, transaction.changes.from) +
            transaction.changes.insert +
            currentMarkdown.slice(transaction.changes.to);
        }

        if (nextMarkdown !== currentMarkdown) {
          recordHistoryBeforeChange(currentMarkdown, "structural");
        }
        markdownRef.current = nextMarkdown;
        blocksRef.current = parseMarkdownBlocks(nextMarkdown);
        commitMarkdownToParent(nextMarkdown, true);

        if (transaction.selection) {
          const targetBlock = findBlockByMarkdownOffset(
            parseMarkdownBlocks(nextMarkdown),
            transaction.selection.anchor,
          );
          if (targetBlock) {
            setFocusRequestId(targetBlock.id);
          }
        }
      },
      get state() {
        const selection = getMarkdownSelection();
        return {
          doc: {
            toString: () => markdownRef.current,
          },
          selection: {
            main: selection,
          },
        };
      },
    }),
    [commitMarkdownToParent, focusBlock, getMarkdownSelection, recordHistoryBeforeChange],
  );

  useEffect(() => {
    onEditorReady?.(liveEditorView);
  }, [liveEditorView, onEditorReady]);

  useLayoutEffect(() => {
    if (!focusRequestId) {
      return;
    }

    focusBlock(focusRequestId);
    setFocusRequestId(null);
  }, [focusBlock, focusRequestId, blocks]);

  const replaceBlock = (
    blockId: string,
    nextRaw: string,
    options: { historyKind?: ChangeHistoryKind; immediate?: boolean } = {},
  ) => {
    const previousMarkdown = markdownRef.current;
    const currentBlocks = blocksRef.current;
    const nextBlocks = currentBlocks.map((block) =>
      block.id === blockId
        ? { ...block, raw: nextRaw, type: classifyBlock(nextRaw) }
        : block,
    );
    const nextMarkdown = joinMarkdownBlocks(nextBlocks);

    if (nextMarkdown === previousMarkdown) {
      return;
    }

    const historyKind = options.historyKind ?? "input";
    const immediate = options.immediate ?? historyKind !== "input";
    recordHistoryBeforeChange(previousMarkdown, historyKind);

    markdownRef.current = nextMarkdown;
    blocksRef.current = immediate ? parseMarkdownBlocks(nextMarkdown) : nextBlocks;
    activeBlockIdRef.current = blockId;
    commitMarkdownToParent(nextMarkdown, immediate);
  };

  const deleteBlock = (blockId: string) => {
    const previousMarkdown = markdownRef.current;
    const currentBlocks = blocksRef.current;
    const blockIndex = currentBlocks.findIndex((block) => block.id === blockId);
    const nextBlocks = currentBlocks.filter((block) => block.id !== blockId);

    if (nextBlocks.length === 0) {
      recordHistoryBeforeChange(previousMarkdown, "structural");
      markdownRef.current = "";
      blocksRef.current = parseMarkdownBlocks("");
      commitMarkdownToParent("", true);
      activeBlockIdRef.current = "block-0";
      setFocusRequestId("block-0");
      return;
    }

    const nextMarkdown = joinMarkdownBlocks(nextBlocks);
    if (nextMarkdown === previousMarkdown) {
      return;
    }
    recordHistoryBeforeChange(previousMarkdown, "structural");
    const reparsedBlocks = parseMarkdownBlocks(nextMarkdown);
    const nextFocusBlock =
      reparsedBlocks[Math.max(0, blockIndex - 1)] ?? reparsedBlocks.at(-1);
    markdownRef.current = nextMarkdown;
    blocksRef.current = reparsedBlocks;
    commitMarkdownToParent(nextMarkdown, true);
    activeBlockIdRef.current = nextFocusBlock?.id ?? null;
    setFocusRequestId(nextFocusBlock?.id ?? null);
  };

  const insertBlockAfter = (
    blockId: string | null,
    raw: string,
  ): string | null => {
    const nextRaw = raw.trimEnd();
    const currentBlocks = blocksRef.current;
    const insertIndex = blockId
      ? Math.max(
          0,
          currentBlocks.findIndex((block) => block.id === blockId) + 1,
        )
      : currentBlocks.length;
    const nextBlocks = [...currentBlocks];
    const nextBlock = createBlock(nextRaw, "\n", insertIndex, 0);
    nextBlocks.splice(insertIndex, 0, nextBlock);
    const previousMarkdown = markdownRef.current;
    const nextMarkdown = joinMarkdownBlocks(nextBlocks);
    if (nextMarkdown !== previousMarkdown) {
      recordHistoryBeforeChange(previousMarkdown, "structural");
    }
    markdownRef.current = nextMarkdown;
    blocksRef.current = parseMarkdownBlocks(nextMarkdown);
    commitMarkdownToParent(nextMarkdown, true);

    // parseMarkdownBlocks re-creates ids from block order after state update.
    return `block-${insertIndex}`;
  };

  const requestInsertAfter = (blockId: string | null) => {
    const existingBlocks = blocksRef.current;
    const fallbackBlockId = existingBlocks.at(-1)?.id ?? null;
    const anchorBlockId = blockId ?? fallbackBlockId;
    const newBlockId = insertBlockAfter(anchorBlockId, "");
    activeBlockIdRef.current = newBlockId;
    setFocusRequestId(newBlockId);
  };

  const insertMarkdownAtLiveAnchor = (
    anchorBlockId: string | null,
    insertText: string,
  ) => {
    const currentBlocks = blocksRef.current;
    const normalizedInsertText = insertText.replace(/\r\n/g, "\n").trim();

    if (!normalizedInsertText) {
      return;
    }

    const insertedBlocks = parseMarkdownBlocks(normalizedInsertText)
      .filter((block) => block.raw.trim() !== "")
      .map((block) => block.raw);

    if (insertedBlocks.length === 0) {
      return;
    }

    const anchorIndex = anchorBlockId
      ? currentBlocks.findIndex((block) => block.id === anchorBlockId)
      : currentBlocks.length - 1;
    const safeAnchorIndex =
      anchorIndex >= 0 ? anchorIndex : currentBlocks.length - 1;
    const anchorBlock = currentBlocks[safeAnchorIndex];
    const nextBlocks = [...currentBlocks];

    if (anchorBlock?.type === "blank") {
      nextBlocks.splice(
        safeAnchorIndex,
        1,
        ...insertedBlocks.map((raw, offset) =>
          createBlock(raw, "\n", safeAnchorIndex + offset, 0),
        ),
        createBlock("", "\n", safeAnchorIndex + insertedBlocks.length, 0),
      );
    } else {
      nextBlocks.splice(
        safeAnchorIndex + 1,
        0,
        ...insertedBlocks.map((raw, offset) =>
          createBlock(raw, "\n", safeAnchorIndex + 1 + offset, 0),
        ),
        createBlock("", "\n", safeAnchorIndex + 1 + insertedBlocks.length, 0),
      );
    }

    const nextMarkdown = joinMarkdownBlocks(nextBlocks);
    const reparsedBlocks = parseMarkdownBlocks(nextMarkdown);
    const insertedBlockIndex = Math.max(
      0,
      safeAnchorIndex + insertedBlocks.length,
    );
    const nextFocusBlock =
      reparsedBlocks[insertedBlockIndex] ?? reparsedBlocks.at(-1);

    const previousMarkdown = markdownRef.current;
    if (nextMarkdown !== previousMarkdown) {
      recordHistoryBeforeChange(previousMarkdown, "structural");
    }
    markdownRef.current = nextMarkdown;
    blocksRef.current = reparsedBlocks;
    commitMarkdownToParent(nextMarkdown, true);
    activeBlockIdRef.current = nextFocusBlock?.id ?? null;
    setFocusRequestId(nextFocusBlock?.id ?? null);
  };

  const updateTableBlock = (blockId: string, table: MarkdownTable) => {
    replaceBlock(blockId, markdownFromTable(table), {
      historyKind: "input",
      immediate: false,
    });
  };

  const openSourceEditor = (block: MarkdownBlock) => {
    setSourceEditingBlock({
      blockId: block.id,
      draft: block.raw,
    });
  };

  const commitSourceEditor = () => {
    if (!sourceEditingBlock) {
      return;
    }

    replaceBlock(sourceEditingBlock.blockId, sourceEditingBlock.draft);
    setSourceEditingBlock(null);
  };

  const cancelSourceEditor = () => setSourceEditingBlock(null);
  const lastBlockId = blocks.at(-1)?.id ?? null;

  return (
    <section className="live-editor-pane">
      <div className="pane-title">
        <span>Live Preview</span>
        <span>{activeFileName}</span>
      </div>
      <article
        ref={documentElementRef}
        className="live-editor-document live-editor-typora-document"
        tabIndex={0}
        onClick={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }

          const documentElement = documentElementRef.current;
          const nearBlock = documentElement
            ? findNearestRowBlockId(documentElement, event.clientY)
            : null;
          if (nearBlock) {
            activeBlockIdRef.current = nearBlock;
            setFocusRequestId(nearBlock);
            return;
          }

          const existingLastBlock = blocksRef.current.at(-1);
          if (existingLastBlock?.type === "blank") {
            setFocusRequestId(existingLastBlock.id);
            return;
          }

          requestInsertAfter(lastBlockId);
        }}
        onCopyCapture={(event) => {
          if (!allSelectedRef.current) {
            return;
          }

          event.clipboardData.setData("text/plain", markdownRef.current);
          event.clipboardData.setData("text/markdown", markdownRef.current);
          event.clipboardData.setData(
            "text/html",
            renderPortableMarkdownHtml(markdownRenderer, markdownRef.current),
          );
          event.preventDefault();
          allSelectedRef.current = false;
        }}
        onKeyDownCapture={(event) => {
          const key = event.key.toLowerCase();
          if ((event.metaKey || event.ctrlKey) && key === "z") {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
              redoMarkdown();
            } else {
              undoMarkdown();
            }
            return;
          }

          if ((event.metaKey || event.ctrlKey) && key === "y") {
            event.preventDefault();
            event.stopPropagation();
            redoMarkdown();
            return;
          }

          if (
            (event.metaKey || event.ctrlKey) &&
            key === "a"
          ) {
            event.preventDefault();
            event.stopPropagation();
            selectDocumentContents();
            return;
          }

          if (event.key !== "Backspace" && event.key !== "Delete") {
            return;
          }

          const target = event.target as HTMLElement | null;
          const isEditableTarget = Boolean(
            target?.isContentEditable ||
              target?.closest("[contenteditable='true'], input, textarea, select"),
          );
          if (isEditableTarget) {
            return;
          }

          const fallbackBlockId =
            activeBlockIdRef.current ?? blocksRef.current.at(-1)?.id ?? null;
          if (!fallbackBlockId) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          deleteBlock(fallbackBlockId);
        }}
        onPasteCapture={(event) => {
          if (hasImageClipboardItems(event.clipboardData.items)) {
            const targetBlockId =
              findClosestBlockId(event.target) ??
              activeBlockIdRef.current ??
              blocksRef.current.at(-1)?.id ??
              null;
            if (targetBlockId) {
              activeBlockIdRef.current = targetBlockId;
            }
            event.preventDefault();
            event.stopPropagation();
            onImagePaste?.(event.clipboardData.items, (markdown) =>
              insertMarkdownAtLiveAnchor(targetBlockId, markdown),
            );
          }
        }}
        onMouseDownCapture={() => {
          allSelectedRef.current = false;
        }}
      >
        {blocks.map((block) => (
          <div
            className="live-editor-typora-row"
            data-live-row-block-id={block.id}
            key={block.id}
          >
            {sourceEditingBlock?.blockId === block.id ? (
              <SourceBlockEditor
                block={block}
                draft={sourceEditingBlock.draft}
                onCancel={cancelSourceEditor}
                onChange={(draft) =>
                  setSourceEditingBlock({
                    blockId: block.id,
                    draft,
                  })
                }
                onCommit={commitSourceEditor}
              />
            ) : block.type === "blank" ? (
              <EditableBlankLineBlock
                block={block}
                shouldFocus={focusRequestId === block.id}
                onDelete={() => deleteBlock(block.id)}
                onFocus={() => {
                  activeBlockIdRef.current = block.id;
                  setFocusedBlockId(block.id);
                }}
                onImagePaste={onImagePaste}
                onFocusNext={() => focusRelativeBlock(block.id, 1)}
                onFocusPrevious={() => focusRelativeBlock(block.id, -1)}
                onInsertAfter={() => requestInsertAfter(block.id)}
                onRegisterElement={registerEditableElement}
                onTextChange={(text) => {
                  replaceBlock(block.id, text, {
                    historyKind: "input",
                    immediate: false,
                  });
                  setFocusRequestId(block.id);
                }}
              />
            ) : isEditableTextBlock(block) ? (
              <EditableTextBlock
                block={block}
                focused={focusedBlockId === block.id}
                markdownRenderer={markdownRenderer}
                shouldFocus={focusRequestId === block.id}
                onBlur={() => setFocusedBlockId(null)}
                onDelete={() => deleteBlock(block.id)}
                onFocus={() => {
                  activeBlockIdRef.current = block.id;
                  setFocusedBlockId(block.id);
                }}
                onFocusNext={() => focusRelativeBlock(block.id, 1)}
                onFocusPrevious={() => focusRelativeBlock(block.id, -1)}
                onImagePaste={onImagePaste}
                onInsertAfter={() => requestInsertAfter(block.id)}
                onRegisterElement={registerEditableElement}
                onTextChange={(text) =>
                  replaceBlock(block.id, markdownFromEditableText(block, text), {
                    historyKind: "input",
                    immediate: false,
                  })
                }
                onTransformBlock={(nextRaw) => {
                  replaceBlock(block.id, nextRaw, {
                    historyKind: "structural",
                    immediate: true,
                  });
                  setFocusRequestId(block.id);
                }}
              />
            ) : block.type === "code_fence" ? (
              <EditableCodeFenceBlock
                block={block}
                shouldFocus={focusRequestId === block.id}
                onDelete={() => deleteBlock(block.id)}
                onFocus={() => {
                  activeBlockIdRef.current = block.id;
                  setFocusedBlockId(block.id);
                }}
                onImagePaste={onImagePaste}
                onInsertAfter={() => requestInsertAfter(block.id)}
                onCodeChange={(nextRaw) =>
                  replaceBlock(block.id, nextRaw, {
                    historyKind: "input",
                    immediate: false,
                  })
                }
              />
            ) : block.type === "table" ? (
              <EditableTableBlock
                block={block}
                onDelete={() => deleteBlock(block.id)}
                onFocus={() => {
                  activeBlockIdRef.current = block.id;
                  setFocusedBlockId(block.id);
                }}
                onInsertAfter={() => requestInsertAfter(block.id)}
                onTableChange={(table) => updateTableBlock(block.id, table)}
              />
            ) : (
              <RenderedComplexBlock
                activeFileId={activeFileId}
                block={block}
                markdownRenderer={markdownRenderer}
                workspaceRoot={workspaceRoot}
                onDelete={() => deleteBlock(block.id)}
                onEditSource={() => openSourceEditor(block)}
                onFocus={() => {
                  activeBlockIdRef.current = block.id;
                  setFocusedBlockId(block.id);
                }}
                onInsertAfter={() => requestInsertAfter(block.id)}
              />
            )}
          </div>
        ))}
      </article>
    </section>
  );
}

function EditableBlankLineBlock({
  block,
  shouldFocus,
  onDelete,
  onFocus,
  onFocusNext,
  onFocusPrevious,
  onImagePaste,
  onInsertAfter,
  onRegisterElement,
  onTextChange,
}: {
  block: MarkdownBlock;
  shouldFocus: boolean;
  onDelete: () => void;
  onFocus: () => void;
  onFocusNext: () => void;
  onFocusPrevious: () => void;
  onImagePaste?: ImagePasteHandler;
  onInsertAfter: () => void;
  onRegisterElement: (blockId: string, element: HTMLElement | null) => void;
  onTextChange: (text: string) => void;
}) {
  const elementRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (!shouldFocus) {
      return;
    }

    elementRef.current?.focus();
    if (elementRef.current) {
      placeCaretAtEnd(elementRef.current);
    }
  }, [shouldFocus]);

  const handleInput = () => {
    const text = normalizeEditableText(
      elementRef.current?.innerText ?? "",
    ).trimEnd();
    if (text) {
      onTextChange(text);
    }
  };

  const setElementRef = (node: HTMLParagraphElement | null) => {
    elementRef.current = node;
    onRegisterElement(block.id, node);
  };

  return (
    <p
      ref={setElementRef}
      data-block-id={block.id}
      className="live-editor-typora-block live-editor-typora-blank"
      contentEditable
      data-placeholder=" "
      suppressContentEditableWarning
      spellCheck
      onFocus={onFocus}
      onInput={handleInput}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onInsertAfter();
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          onFocusPrevious();
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          onFocusNext();
          return;
        }

        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          event.stopPropagation();
          onDelete();
        }
      }}
      onPaste={(event) => {
        if (hasImageClipboardItems(event.clipboardData.items)) {
          event.preventDefault();
          event.stopPropagation();
          onImagePaste?.(event.clipboardData.items);
          return;
        }

        const plainText = event.clipboardData.getData("text/plain");
        if (!plainText) {
          return;
        }

        event.preventDefault();
        insertPlainTextAtCaret(plainText);
        handleInput();
      }}
    />
  );
}

function EditableCodeFenceBlock({
  block,
  shouldFocus,
  onCodeChange,
  onDelete,
  onFocus,
  onImagePaste,
  onInsertAfter,
}: {
  block: MarkdownBlock;
  shouldFocus: boolean;
  onCodeChange: (nextRaw: string) => void;
  onDelete: () => void;
  onFocus: () => void;
  onImagePaste?: ImagePasteHandler;
  onInsertAfter: () => void;
}) {
  const codeFence = parseCodeFence(block.raw);
  const codeRef = useRef<HTMLElement | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    const codeElement = codeRef.current;
    if (!codeElement || focusedRef.current) {
      return;
    }

    codeElement.innerHTML = highlightCode(codeFence.source, codeFence.language);
  }, [codeFence.language, codeFence.source]);

  useEffect(() => {
    if (!shouldFocus) {
      return;
    }

    const codeElement = codeRef.current;
    if (!codeElement) {
      return;
    }

    codeElement.focus();
    placeCaretAtEnd(codeElement);
  }, [shouldFocus]);

  const commitCodeText = () => {
    const codeText = normalizeCodeText(codeRef.current?.innerText ?? "");
    onCodeChange(codeFenceToMarkdown(codeFence.language, codeText));
  };

  return (
    <figure
      data-block-id={block.id}
      className={`live-editor-code-card live-editor-code-language-${cssSafeLanguage(codeFence.language)}`}
    >
      <figcaption>
        <span>{codeFence.language || "code"}</span>
        <label className="live-editor-code-language-control">
          <span>language</span>
          <input
            aria-label="Code block language"
            value={codeFence.language}
            onChange={(event) => {
              const nextLanguage = event.currentTarget.value
                .trim()
                .toLowerCase();
              const nextSource = codeRef.current
                ? normalizeCodeText(codeRef.current.innerText)
                : codeFence.source;
              onCodeChange(codeFenceToMarkdown(nextLanguage, nextSource));
            }}
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          />
        </label>
      </figcaption>
      <pre>
        <code
          ref={codeRef}
          data-block-id={block.id}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          tabIndex={0}
          onBlur={() => {
            focusedRef.current = false;
            commitCodeText();
            if (codeRef.current) {
              codeRef.current.innerHTML = highlightCode(
                normalizeCodeText(codeRef.current.innerText),
                codeFence.language,
              );
            }
          }}
          onFocus={() => {
            focusedRef.current = true;
            onFocus();
            if (codeRef.current) {
              codeRef.current.textContent = codeFence.source;
            }
          }}
          onInput={commitCodeText}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === "b"
            ) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }

            if (event.key === "Backspace" || event.key === "Delete") {
              const codeElement = codeRef.current;
              if (!codeElement) {
                return;
              }

              if (hasNonCollapsedSelectionInside(codeElement)) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();

              const codeText = normalizeCodeText(codeElement.innerText ?? "");
              const caretOffset = getCaretOffsetInside(codeElement) ?? codeText.length;

              if (!codeText || caretOffset <= 0) {
                onDelete();
                return;
              }

              const nextOffset = Math.max(0, caretOffset - 1);
              const nextCodeText = `${codeText.slice(0, nextOffset)}${codeText.slice(caretOffset)}`;

              if (!nextCodeText) {
                onDelete();
                return;
              }

              codeElement.textContent = nextCodeText;
              onCodeChange(codeFenceToMarkdown(codeFence.language, nextCodeText));
              window.requestAnimationFrame(() => {
                if (codeRef.current) {
                  placeCaretAtOffset(codeRef.current, nextOffset);
                }
              });
              return;
            }

            if (event.key === "Tab") {
              event.preventDefault();
              insertPlainTextAtCaret("  ");
              commitCodeText();
              return;
            }

            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onInsertAfter();
              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();
              insertPlainTextAtCaret("\n");
              commitCodeText();
            }
          }}
          onPaste={(event) => {
            if (hasImageClipboardItems(event.clipboardData.items)) {
              event.preventDefault();
              event.stopPropagation();
              onImagePaste?.(event.clipboardData.items);
              return;
            }

            const plainText = event.clipboardData.getData("text/plain");
            if (!plainText) {
              return;
            }

            event.preventDefault();
            insertPlainTextAtCaret(plainText);
            commitCodeText();
          }}
        />
      </pre>
    </figure>
  );
}

function EditableTextBlock({
  block,
  focused,
  markdownRenderer,
  shouldFocus,
  onBlur,
  onDelete,
  onFocus,
  onFocusNext,
  onFocusPrevious,
  onImagePaste,
  onInsertAfter,
  onRegisterElement,
  onTextChange,
  onTransformBlock,
}: {
  block: MarkdownBlock;
  focused: boolean;
  markdownRenderer: MarkdownIt;
  shouldFocus: boolean;
  onBlur: () => void;
  onDelete: () => void;
  onFocus: () => void;
  onFocusNext: () => void;
  onFocusPrevious: () => void;
  onImagePaste?: ImagePasteHandler;
  onInsertAfter: () => void;
  onRegisterElement: (blockId: string, element: HTMLElement | null) => void;
  onTextChange: (text: string) => void;
  onTransformBlock: (nextRaw: string) => void;
}) {
  const elementRef = useRef<HTMLElement | null>(null);
  const latestTextRef = useRef(editableTextFromMarkdown(block));

  useLayoutEffect(() => {
    const nextEditableText = editableTextFromMarkdown(block);
    latestTextRef.current = nextEditableText;

    const element = elementRef.current;
    if (!element) {
      return;
    }

    if (focused) {
      // When a blank block becomes a text block, React swaps the DOM node.
      // The new focused contentEditable starts empty unless we seed it here.
      // Without this, typing `2 + Enter + 2 + Enter + 2` makes the third `2`
      // invisible until the next Enter, which looks like duplicated/delayed lines.
      const currentDomText = normalizeEditableText(
        element.innerText ?? "",
      ).trimEnd();
      if (!currentDomText && nextEditableText) {
        element.textContent = nextEditableText;
        placeCaretAtEnd(element);
      }
      return;
    }

    renderPreviewIntoElement(element, block, markdownRenderer);
  }, [block, focused, markdownRenderer]);

  useEffect(() => {
    if (!shouldFocus) {
      return;
    }

    const element = elementRef.current;
    if (!element) {
      return;
    }

    element.focus();
    placeCaretAtEnd(element);
  }, [shouldFocus]);

  const handleFocus = () => {
    onFocus();
  };

  const handleInput = () => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const text = normalizeEditableText(
      markdownInlineFromEditableElement(element),
    );
    latestTextRef.current = text;
    onTextChange(text);
  };

  const handleBlur = () => {
    onBlur();
    const element = elementRef.current;
    if (element) {
      renderPreviewIntoElement(element, block, markdownRenderer);
    }
  };

  const applyHeadingShortcut = (level: number) => {
    const text = latestTextRef.current.trimEnd();
    const marks = "#".repeat(level);
    onTransformBlock(text ? `${marks} ${text}` : `${marks} `);
  };

  const applyParagraphShortcut = () => {
    onTransformBlock(latestTextRef.current.trimEnd());
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && /^[1-6]$/.test(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      applyHeadingShortcut(Number(event.key));
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "0") {
      event.preventDefault();
      event.stopPropagation();
      applyParagraphShortcut();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      event.stopPropagation();
      const element = elementRef.current;
      const offsets = element ? getSelectionOffsetsInside(element) : null;
      if (element && offsets && offsets.from !== offsets.to) {
        const currentText = latestTextRef.current;
        const selectedText = currentText.slice(offsets.from, offsets.to);
        const nextText = `${currentText.slice(0, offsets.from)}**${selectedText}**${currentText.slice(offsets.to)}`;
        latestTextRef.current = nextText;
        onTextChange(nextText);
        renderPreviewIntoElement(
          element,
          {
            ...block,
            raw: markdownFromEditableText(block, nextText),
            type: classifyBlock(markdownFromEditableText(block, nextText)),
          },
          markdownRenderer,
        );
        placeCaretAtEnd(element);
        return;
      }

      insertPlainTextAtCaret("****");
      handleInput();
      return;
    }

    if (event.key === "ArrowUp") {
      const element = elementRef.current;
      if (element && isCaretAtStart(element)) {
        event.preventDefault();
        onFocusPrevious();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      const element = elementRef.current;
      if (element && isCaretAtEnd(element)) {
        event.preventDefault();
        onFocusNext();
      }
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const completedCodeFence = completeCodeFenceFromOpener(
        latestTextRef.current,
      );
      if (completedCodeFence) {
        onTransformBlock(completedCodeFence);
        return;
      }

      onInsertAfter();
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      const element = elementRef.current;
      if (!element) {
        return;
      }

      if (hasNonCollapsedSelectionInside(element)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const currentText = normalizeEditableText(
        markdownInlineFromEditableElement(element),
      );
      const caretOffset = getCaretOffsetInside(element) ?? currentText.length;

      if (!currentText.trim() || caretOffset <= 0) {
        onDelete();
        return;
      }

      const nextOffset = Math.max(0, caretOffset - 1);
      const nextText = `${currentText.slice(0, nextOffset)}${currentText.slice(caretOffset)}`;

      if (!nextText.trim()) {
        onDelete();
        return;
      }

      latestTextRef.current = nextText;
      element.textContent = nextText;
      onTextChange(nextText);
      window.requestAnimationFrame(() => {
        if (elementRef.current) {
          placeCaretAtOffset(elementRef.current, nextOffset);
        }
      });
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    if (hasImageClipboardItems(event.clipboardData.items)) {
      event.preventDefault();
      event.stopPropagation();
      onImagePaste?.(event.clipboardData.items);
      return;
    }

    const plainText = event.clipboardData.getData("text/plain");
    if (!plainText) {
      return;
    }

    event.preventDefault();
    insertPlainTextAtCaret(plainText);
    handleInput();
  };

  const setElementRef = (node: HTMLElement | null) => {
    elementRef.current = node;
    onRegisterElement(block.id, node);
  };

  const commonProps = {
    ref: setElementRef,
    className: `live-editor-typora-block live-editor-typora-${block.type}`,
    "data-block-id": block.id,
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: true,
    onBlur: handleBlur,
    onFocus: handleFocus,
    onInput: handleInput,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
  };

  if (block.type === "heading") {
    const HeadingTag = `h${headingLevel(block.raw)}` as
      | "h1"
      | "h2"
      | "h3"
      | "h4"
      | "h5"
      | "h6";
    return <HeadingTag {...commonProps} />;
  }

  if (block.type === "blockquote") {
    return <blockquote {...commonProps} />;
  }

  if (block.type === "list") {
    return <div {...commonProps} />;
  }

  return <p {...commonProps} />;
}

function EditableTableBlock({
  block,
  onDelete,
  onFocus,
  onInsertAfter,
  onTableChange,
}: {
  block: MarkdownBlock;
  onDelete: () => void;
  onFocus: () => void;
  onInsertAfter: () => void;
  onTableChange: (table: MarkdownTable) => void;
}) {
  const parsedTable = useMemo(() => parseMarkdownTable(block.raw), [block.raw]);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const deletingRef = useRef(false);

  if (!parsedTable) {
    return null;
  }

  const updateCell = (
    section: "header" | "body",
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) => {
    if (deletingRef.current) {
      return;
    }

    const nextTable: MarkdownTable = {
      headers: [...parsedTable.headers],
      rows: parsedTable.rows.map((row) => [...row]),
    };

    if (section === "header") {
      nextTable.headers[columnIndex] = normalizeTableCell(value);
    } else {
      nextTable.rows[rowIndex][columnIndex] = normalizeTableCell(value);
    }

    onTableChange(nextTable);
  };

  const focusNextCell = (currentCell: HTMLElement, backwards: boolean) => {
    const table = tableRef.current;
    if (!table) {
      return;
    }

    const cells = Array.from(
      table.querySelectorAll<HTMLElement>(
        "th[contenteditable], td[contenteditable]",
      ),
    );
    const currentIndex = cells.indexOf(currentCell);
    const nextIndex = backwards
      ? Math.max(0, currentIndex - 1)
      : Math.min(cells.length - 1, currentIndex + 1);
    const nextCell = cells[nextIndex] as HTMLElement | undefined;
    nextCell?.focus();
    if (nextCell) {
      placeCaretAtEnd(nextCell);
    }
  };

  const deleteTable = () => {
    deletingRef.current = true;
    onDelete();
  };

  const isCurrentCellEmpty = (cell: HTMLElement) =>
    normalizeEditableText(cell.innerText).trim().length === 0;

  const handleTableKeyDown = (event: ReactKeyboardEvent<HTMLTableElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      deleteTable();
    }
  };

  const handleCellKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Backspace" || event.key === "Delete") {
      if (isCurrentCellEmpty(event.currentTarget)) {
        event.preventDefault();
        event.stopPropagation();
        deleteTable();
      }
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      focusNextCell(event.currentTarget, event.shiftKey);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onInsertAfter();
    }
  };

  return (
    <table
      ref={tableRef}
      data-block-id={block.id}
      className="live-editor-typora-table"
      onFocus={onFocus}
      onKeyDown={handleTableKeyDown}
      tabIndex={0}
    >
      <thead>
        <tr>
          {parsedTable.headers.map((header, columnIndex) => (
            <th
              contentEditable
              key={`header-${columnIndex}`}
              suppressContentEditableWarning
              onBlur={(event) =>
                updateCell(
                  "header",
                  0,
                  columnIndex,
                  event.currentTarget.innerText,
                )
              }
              onKeyDown={handleCellKeyDown}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {parsedTable.rows.map((row, rowIndex) => (
          <tr key={`row-${rowIndex}`}>
            {parsedTable.headers.map((_, columnIndex) => (
              <td
                contentEditable
                key={`cell-${rowIndex}-${columnIndex}`}
                suppressContentEditableWarning
                onBlur={(event) =>
                  updateCell(
                    "body",
                    rowIndex,
                    columnIndex,
                    event.currentTarget.innerText,
                  )
                }
                onKeyDown={handleCellKeyDown}
              >
                {row[columnIndex] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RenderedComplexBlock({
  activeFileId,
  block,
  markdownRenderer,
  workspaceRoot,
  onDelete,
  onEditSource,
  onFocus,
  onInsertAfter,
}: {
  activeFileId: string;
  block: MarkdownBlock;
  markdownRenderer: MarkdownIt;
  workspaceRoot: string;
  onDelete: () => void;
  onEditSource: () => void;
  onFocus: () => void;
  onInsertAfter: () => void;
}) {
  const image = getImageBlock(block.raw);
  const diagram = getDiagramBlock(block.raw);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onInsertAfter();
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      onDelete();
    }
  };

  if (image) {
    return (
      <div
        data-block-id={block.id}
        className="live-editor-block live-editor-image-block live-editor-complex-block"
        onDoubleClick={onEditSource}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        title="Double-click to edit Markdown source"
      >
        <MarkdownImage
          activeFileId={activeFileId}
          alt={image.alt}
          markdown={image.markdown}
          src={image.src}
          title={image.title}
          workspaceRoot={workspaceRoot}
          onDelete={onDelete}
        />
      </div>
    );
  }

  if (diagram?.type === "mermaid") {
    return (
      <div
        data-block-id={block.id}
        className="live-editor-block live-editor-complex-block"
        onDoubleClick={onEditSource}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        title="Double-click to edit Mermaid source"
      >
        <MermaidBlock
          diagramId={`live-mermaid-${block.id}`}
          source={diagram.source}
        />
      </div>
    );
  }

  if (diagram?.type === "plantuml") {
    return (
      <div
        data-block-id={block.id}
        className="live-editor-block live-editor-complex-block"
        onDoubleClick={onEditSource}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        title="Double-click to edit PlantUML source"
      >
        <PlantUmlBlock
          diagramId={`live-plantuml-${block.id}`}
          source={diagram.source}
        />
      </div>
    );
  }

  return (
    <div
      data-block-id={block.id}
      className={`live-editor-block live-editor-complex-block live-editor-block-${block.type}`}
      onDoubleClick={onEditSource}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      title="Double-click to edit Markdown source"
      dangerouslySetInnerHTML={{
        __html: markdownRenderer.render(block.raw),
      }}
    />
  );
}

function SourceBlockEditor({
  block,
  draft,
  onCancel,
  onChange,
  onCommit,
}: {
  block: MarkdownBlock;
  draft: string;
  onCancel: () => void;
  onChange: (draft: string) => void;
  onCommit: () => void;
}) {
  const didCancelRef = useRef(false);
  const commitUnlessCancelled = () => {
    if (didCancelRef.current) {
      didCancelRef.current = false;
      return;
    }

    onCommit();
  };
  const cancelEditing = () => {
    didCancelRef.current = true;
    onCancel();
  };

  return (
    <textarea
      autoFocus
      className="live-editor-block-source"
      value={draft}
      onBlur={commitUnlessCancelled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelEditing();
        }

        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onCommit();
        }
      }}
      aria-label={`Edit ${block.type} source`}
    />
  );
}

function isEditableTextBlock(block: MarkdownBlock): block is MarkdownBlock & {
  type: EditableTextBlockKind;
} {
  return (
    block.type === "heading" ||
    block.type === "paragraph" ||
    block.type === "blockquote" ||
    block.type === "list"
  );
}

function parseMarkdownBlocks(markdownContent: string): MarkdownBlock[] {
  if (markdownContent.length === 0) {
    return [createBlock("", "\n", 0, 0)];
  }

  const normalized = markdownContent.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    lineStarts.push(offset);
    offset += lines[index].length + (index < lines.length - 1 ? 1 : 0);
  }

  const blocks: MarkdownBlock[] = [];
  let lineIndex = 0;

  const pushBlock = (raw: string, startLine: number) => {
    blocks.push(
      createBlock(raw, "\n", blocks.length, lineStarts[startLine] ?? 0),
    );
  };

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];

    if (line.trim() === "") {
      pushBlock("", lineIndex);
      lineIndex += 1;
      continue;
    }

    if (/^```/.test(line.trim())) {
      const startLine = lineIndex;
      lineIndex += 1;
      while (
        lineIndex < lines.length &&
        !/^```\s*$/.test(lines[lineIndex].trim())
      ) {
        lineIndex += 1;
      }
      if (lineIndex < lines.length) {
        lineIndex += 1;
      }
      pushBlock(lines.slice(startLine, lineIndex).join("\n"), startLine);
      continue;
    }

    if (
      lineIndex + 1 < lines.length &&
      line.includes("|") &&
      isTableSeparatorLine(lines[lineIndex + 1])
    ) {
      const startLine = lineIndex;
      lineIndex += 2;
      while (
        lineIndex < lines.length &&
        lines[lineIndex].trim() !== "" &&
        lines[lineIndex].includes("|")
      ) {
        lineIndex += 1;
      }
      pushBlock(lines.slice(startLine, lineIndex).join("\n"), startLine);
      continue;
    }

    if (/^#{1,6}\s*/.test(line) || /^---+$/.test(line.trim())) {
      pushBlock(line, lineIndex);
      lineIndex += 1;
      continue;
    }

    if (/^>\s?/.test(line.trim())) {
      const startLine = lineIndex;
      while (
        lineIndex < lines.length &&
        /^>\s?/.test(lines[lineIndex].trim())
      ) {
        lineIndex += 1;
      }
      pushBlock(lines.slice(startLine, lineIndex).join("\n"), startLine);
      continue;
    }

    if (/^\s*(?:[-*+]\s+|\d+\.\s+|- \[[ xX]]\s+)/.test(line)) {
      const startLine = lineIndex;
      while (
        lineIndex < lines.length &&
        lines[lineIndex].trim() !== "" &&
        !/^```/.test(lines[lineIndex].trim())
      ) {
        lineIndex += 1;
      }
      pushBlock(lines.slice(startLine, lineIndex).join("\n"), startLine);
      continue;
    }

    pushBlock(line, lineIndex);
    lineIndex += 1;
  }

  return blocks;
}

function createBlock(
  raw: string,
  separator: string,
  index: number,
  start: number,
): MarkdownBlock {
  return {
    id: `block-${index}`,
    raw,
    separator,
    start,
    end: start + raw.length,
    type: classifyBlock(raw),
  };
}

function classifyBlock(raw: string): MarkdownBlockType {
  const trimmed = raw.trim();

  if (!trimmed) {
    return "blank";
  }

  if (/^#{1,6}\s*/.test(raw)) {
    return "heading";
  }

  if (/^```/.test(trimmed)) {
    const diagram = getDiagramBlock(trimmed);
    return diagram ? "diagram" : "code_fence";
  }

  if (/^\$\$[\s\S]*\$\$$/.test(trimmed)) {
    return "math";
  }

  if (/^!\[[^\]]*]\(/.test(trimmed)) {
    return "image";
  }

  if (parseMarkdownTable(trimmed)) {
    return "table";
  }

  if (/^([-*+]\s+|\d+\.\s+|- \[[ xX]]\s+)/m.test(trimmed)) {
    return "list";
  }

  if (/^>\s+/m.test(trimmed)) {
    return "blockquote";
  }

  if (/^---+$/.test(trimmed)) {
    return "horizontal_rule";
  }

  return "paragraph";
}

function joinMarkdownBlocks(blocks: MarkdownBlock[]): string {
  return blocks.map((block) => block.raw).join("\n");
}

function headingLevel(raw: string): number {
  return raw.match(/^#{1,6}/)?.[0].length ?? 1;
}

function editableTextFromMarkdown(block: MarkdownBlock): string {
  if (block.type === "heading") {
    return block.raw.replace(/^#{1,6}\s*/, "");
  }

  if (block.type === "blockquote") {
    return block.raw
      .split("\n")
      .map((line) => line.replace(/^>\s?/, ""))
      .join("\n");
  }

  if (block.type === "list") {
    return block.raw
      .split("\n")
      .map((line) =>
        line.replace(/^\s*(?:[-*+]\s+|\d+\.\s+|- \[[ xX]]\s+)/, ""),
      )
      .join("\n");
  }

  return block.raw;
}

function markdownFromEditableText(block: MarkdownBlock, text: string): string {
  const normalizedText = text.replace(/\n{3,}/g, "\n\n").trimEnd();

  if (block.type === "heading") {
    const marks = "#".repeat(headingLevel(block.raw));
    return normalizedText ? `${marks} ${normalizedText}` : `${marks} `;
  }

  if (block.type === "blockquote") {
    return normalizedText
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }

  if (block.type === "list") {
    return normalizedText
      .split("\n")
      .map((line) => `- ${line}`)
      .join("\n");
  }

  return normalizedText;
}

function editableSourcePrefixLength(block: MarkdownBlock): number {
  if (block.type === "heading") {
    return block.raw.match(/^#{1,6}\s*/)?.[0].length ?? 0;
  }

  if (block.type === "blockquote") {
    return block.raw.match(/^>\s?/)?.[0].length ?? 0;
  }

  if (block.type === "list") {
    return (
      block.raw.match(/^\s*(?:[-*+]\s+|\d+\.\s+|- \[[ xX]]\s+)/)?.[0].length ??
      0
    );
  }

  return 0;
}

function renderPreviewIntoElement(
  element: HTMLElement,
  block: MarkdownBlock,
  markdownRenderer: MarkdownIt,
) {
  if (block.type === "heading") {
    element.textContent = editableTextFromMarkdown(block);
    return;
  }

  if (
    block.type === "blockquote" ||
    block.type === "paragraph" ||
    block.type === "list"
  ) {
    element.innerHTML = markdownRenderer.renderInline(
      editableTextFromMarkdown(block),
    );
    return;
  }

  element.textContent = editableTextFromMarkdown(block);
}

function parseMarkdownTable(raw: string): MarkdownTable | null {
  const lines = raw
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2 || !isTableSeparatorLine(lines[1])) {
    return null;
  }

  const headers = parseTableRow(lines[0]);
  if (headers.length === 0) {
    return null;
  }

  const rows = lines.slice(2).map((line) => {
    const cells = parseTableRow(line);
    return Array.from(
      { length: headers.length },
      (_, index) => cells[index] ?? "",
    );
  });

  return {
    headers,
    rows:
      rows.length > 0
        ? rows
        : [Array.from({ length: headers.length }, () => "")],
  };
}

function parseTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparatorLine(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
}

function markdownFromTable(table: MarkdownTable): string {
  const headers = table.headers.map((header) => header || " ");
  const rows = table.rows.length > 0 ? table.rows : [headers.map(() => "")];
  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map(
    (row) => `| ${headers.map((_, index) => row[index] ?? "").join(" | ")} |`,
  );

  return [headerLine, separatorLine, ...rowLines].join("\n");
}

function normalizeTableCell(value: string): string {
  return value.replace(/\n/g, " ").replace(/\|/g, "\\|").trim();
}

function completeCodeFenceFromOpener(text: string): string | null {
  const opener = text.trim();
  if (!/^```[^`\n]*$/.test(opener)) {
    return null;
  }

  return `${opener}\n\n\`\`\``;
}

function normalizeEditableText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n");
}

function placeCaretAtEnd(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtStart(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtOffset(element: HTMLElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remainingOffset = Math.max(0, offset);
  let textNode = walker.nextNode() as Text | null;

  while (textNode) {
    if (remainingOffset <= textNode.data.length) {
      const range = document.createRange();
      range.setStart(textNode, remainingOffset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    remainingOffset -= textNode.data.length;
    textNode = walker.nextNode() as Text | null;
  }

  placeCaretAtEnd(element);
}

function hasNonCollapsedSelectionInside(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }

  const range = selection.getRangeAt(0);
  return (
    element.contains(range.startContainer) &&
    element.contains(range.endContainer)
  );
}

function getCaretOffsetInside(element: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) {
    return null;
  }

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(element);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  return beforeRange.toString().length;
}

function isCaretAtStart(element: HTMLElement): boolean {
  return (getCaretOffsetInside(element) ?? 0) <= 0;
}

function isCaretAtEnd(element: HTMLElement): boolean {
  const offset = getCaretOffsetInside(element);
  if (offset === null) {
    return false;
  }

  return offset >= element.innerText.length;
}

function insertPlainTextAtCaret(text: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  selection.deleteFromDocument();
  selection.getRangeAt(0).insertNode(document.createTextNode(text));
  selection.collapseToEnd();
}

function markdownInlineFromEditableElement(element: HTMLElement): string {
  return Array.from(element.childNodes)
    .map((node) => markdownInlineFromNode(node))
    .join("");
}

function markdownInlineFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const tagName = node.tagName.toLowerCase();
  if (tagName === "br") {
    return "\n";
  }

  const children = Array.from(node.childNodes)
    .map((child) => markdownInlineFromNode(child))
    .join("");

  if (
    tagName === "strong" ||
    tagName === "b" ||
    node.style.fontWeight === "bold" ||
    Number(node.style.fontWeight) >= 600
  ) {
    return children ? `**${children}**` : "";
  }

  if (
    tagName === "em" ||
    tagName === "i" ||
    node.style.fontStyle === "italic"
  ) {
    return children ? `*${children}*` : "";
  }

  if (tagName === "code") {
    return children ? `\`${children}\`` : "";
  }

  if (tagName === "a") {
    const href = node.getAttribute("href");
    return href ? `[${children}](${href})` : children;
  }

  if (tagName === "div" || tagName === "p") {
    return children.endsWith("\n") ? children : `${children}\n`;
  }

  return children;
}

function findNearestRowBlockId(
  documentElement: HTMLElement,
  clientY: number,
): string | null {
  const rows = Array.from(
    documentElement.querySelectorAll<HTMLElement>("[data-live-row-block-id]"),
  );
  if (rows.length === 0) {
    return null;
  }

  let previousBlockId: string | null = null;
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    const rowBlockId = row.dataset.liveRowBlockId ?? null;
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return rowBlockId;
    }
    if (clientY < rect.top) {
      return previousBlockId ?? rowBlockId;
    }
    previousBlockId = rowBlockId;
  }

  const lastRow = rows.at(-1);
  if (!lastRow) {
    return previousBlockId;
  }
  const lastRect = lastRow.getBoundingClientRect();
  if (clientY > lastRect.bottom + 24) {
    return null;
  }
  return previousBlockId;
}

function getSelectionOffsetsInside(
  element: HTMLElement,
): { from: number; to: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (
    !element.contains(range.startContainer) ||
    !element.contains(range.endContainer)
  ) {
    return null;
  }

  const startRange = document.createRange();
  startRange.selectNodeContents(element);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = document.createRange();
  endRange.selectNodeContents(element);
  endRange.setEnd(range.endContainer, range.endOffset);

  return {
    from: startRange.toString().length,
    to: endRange.toString().length,
  };
}

function findBlockByMarkdownOffset(
  blocks: MarkdownBlock[],
  offset: number,
): MarkdownBlock | null {
  return (
    blocks.find(
      (block) =>
        offset >= block.start && offset <= block.end + block.separator.length,
    ) ??
    blocks.at(-1) ??
    null
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cssEscapeIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function parseCodeFence(raw: string): { language: string; source: string } {
  const match = raw.trimEnd().match(/^```([^`\n]*)\n([\s\S]*?)\n?```$/);
  if (!match) {
    return { language: "text", source: raw };
  }

  return {
    language: match[1].trim().toLowerCase() || "text",
    source: match[2] ?? "",
  };
}

function codeFenceToMarkdown(language: string, source: string): string {
  return `\`\`\`${language}\n${source.replace(/\s+$/, "")}\n\`\`\``;
}

function cssSafeLanguage(language: string): string {
  return (language || "text").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

function normalizeCodeText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\n$/, "");
}

function findClosestBlockId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }

  return (
    target.closest<HTMLElement>("[data-block-id]")?.dataset.blockId ?? null
  );
}

function hasImageClipboardItems(items: DataTransferItemList): boolean {
  return Array.from(items).some((item) => item.type.startsWith("image/"));
}

function renderPortableMarkdownHtml(
  markdownRenderer: MarkdownIt,
  markdown: string,
): string {
  const rendered = markdownRenderer.render(markdown);
  return `<article style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;background:#ffffff;line-height:1.7;font-size:15px;">${rendered}
<style>
  article h1{font-size:32px;line-height:1.25;margin:0 0 18px;color:#030712;}
  article h2{font-size:26px;line-height:1.28;margin:24px 0 14px;color:#030712;}
  article h3{font-size:21px;line-height:1.32;margin:20px 0 12px;color:#030712;}
  article p{margin:0 0 12px;}
  article table{border-collapse:collapse;margin:16px 0;width:100%;}
  article th,article td{border:1px solid #9ca3af;padding:8px 10px;color:#000000;}
  article th{background:#f3f4f6;font-weight:700;}
  article pre{background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:12px 14px;overflow:auto;}
  article code{font-family:'SFMono-Regular',Consolas,monospace;}
  article blockquote{border-left:3px solid #2563eb;margin:12px 0;padding-left:12px;color:#374151;}
</style></article>`;
}

function highlightCode(source: string, language: string): string {
  const safeLanguage = cssSafeLanguage(language);
  if (["json"].includes(safeLanguage)) {
    return highlightJson(source);
  }

  if (["java", "kotlin", "kt"].includes(safeLanguage)) {
    return highlightKeywordLanguage(source, [
      "abstract",
      "assert",
      "boolean",
      "break",
      "byte",
      "case",
      "catch",
      "char",
      "class",
      "const",
      "continue",
      "default",
      "do",
      "double",
      "else",
      "enum",
      "extends",
      "final",
      "finally",
      "float",
      "for",
      "if",
      "implements",
      "import",
      "instanceof",
      "int",
      "interface",
      "long",
      "native",
      "new",
      "package",
      "private",
      "protected",
      "public",
      "return",
      "short",
      "static",
      "strictfp",
      "super",
      "switch",
      "synchronized",
      "this",
      "throw",
      "throws",
      "transient",
      "try",
      "void",
      "volatile",
      "while",
      "var",
      "record",
    ]);
  }

  if (
    ["js", "jsx", "javascript", "ts", "tsx", "typescript"].includes(
      safeLanguage,
    )
  ) {
    return highlightKeywordLanguage(source, [
      "as",
      "async",
      "await",
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "default",
      "delete",
      "do",
      "else",
      "export",
      "extends",
      "finally",
      "for",
      "from",
      "function",
      "if",
      "import",
      "in",
      "instanceof",
      "interface",
      "let",
      "new",
      "of",
      "private",
      "protected",
      "public",
      "return",
      "static",
      "switch",
      "throw",
      "try",
      "type",
      "typeof",
      "var",
      "void",
      "while",
      "yield",
    ]);
  }

  if (["rs", "rust"].includes(safeLanguage)) {
    return highlightKeywordLanguage(source, [
      "as",
      "async",
      "await",
      "break",
      "const",
      "continue",
      "crate",
      "dyn",
      "else",
      "enum",
      "extern",
      "false",
      "fn",
      "for",
      "if",
      "impl",
      "in",
      "let",
      "loop",
      "match",
      "mod",
      "move",
      "mut",
      "pub",
      "ref",
      "return",
      "self",
      "Self",
      "static",
      "struct",
      "super",
      "trait",
      "true",
      "type",
      "unsafe",
      "use",
      "where",
      "while",
    ]);
  }

  if (["sql"].includes(safeLanguage)) {
    return highlightKeywordLanguage(source, [
      "select",
      "from",
      "where",
      "insert",
      "into",
      "update",
      "delete",
      "join",
      "left",
      "right",
      "inner",
      "outer",
      "on",
      "group",
      "by",
      "order",
      "limit",
      "offset",
      "having",
      "and",
      "or",
      "not",
      "null",
      "is",
      "create",
      "alter",
      "drop",
      "table",
      "index",
      "view",
      "case",
      "when",
      "then",
      "else",
      "end",
      "distinct",
      "union",
      "all",
      "values",
      "set",
    ]);
  }

  return escapeHtml(source);
}

function highlightJson(source: string): string {
  return escapeHtml(source)
    .replace(
      /(&quot;(?:\\\\.|[^&])*?&quot;)(\s*:)?/g,
      (_match, keyOrString: string, colon: string) => {
        const tokenClass = colon ? "syntax-key" : "syntax-string";
        return `<span class="${tokenClass}">${keyOrString}</span>${colon ?? ""}`;
      },
    )
    .replace(
      /\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi,
      '<span class="syntax-number">$1</span>',
    )
    .replace(
      /\b(true|false|null)\b/g,
      '<span class="syntax-literal">$1</span>',
    );
}

function highlightKeywordLanguage(source: string, keywords: string[]): string {
  const keywordPattern = new RegExp(
    `\\b(${keywords.map(escapeRegExp).join("|")})\\b`,
    "gi",
  );
  return escapeHtml(source)
    .replace(
      /(&quot;(?:\\\\.|[^&])*?&quot;|'(?:\\\\.|[^'])*')/g,
      '<span class="syntax-string">$1</span>',
    )
    .replace(/(\/\/.*$|#.*$)/gm, '<span class="syntax-comment">$1</span>')
    .replace(keywordPattern, '<span class="syntax-keyword">$1</span>')
    .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="syntax-number">$1</span>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getDiagramBlock(
  markdownBlock: string,
): { type: "mermaid" | "plantuml"; source: string } | null {
  const match = markdownBlock
    .trim()
    .match(/^```([^\n`]*)\n([\s\S]*?)^```[ \t]*$/m);

  if (!match) {
    return null;
  }

  const language = match[1].trim().toLowerCase();
  if (language === "mermaid") {
    return { type: "mermaid", source: match[2] };
  }

  if (["plantuml", "puml", "uml"].includes(language)) {
    return { type: "plantuml", source: match[2] };
  }

  return null;
}

function getImageBlock(
  markdownBlock: string,
): { alt: string; markdown: string; src: string; title?: string } | null {
  const match = markdownBlock
    .trim()
    .match(/^!\[([^\]]*)]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);

  if (!match) {
    return null;
  }

  return {
    alt: match[1],
    markdown: match[0],
    src: match[2],
    title: match[3],
  };
}
