import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export type ImagePasteHandler = (
  items: DataTransferItemList,
  insertMarkdown?: (markdown: string) => void,
) => void;

/**
 * Bridges a clipboard image to the workspace image writer while keeping the
 * resulting Markdown insertion in the active CodeMirror transaction.
 */
export function createImagePasteExtension(
  onImagePaste: ImagePasteHandler | undefined,
) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const items = event.clipboardData?.items;
      if (!items || !onImagePaste) {
        return false;
      }

      const hasImage = Array.from(items).some((item) =>
        (item as DataTransferItem).type.startsWith("image/"),
      );
      if (!hasImage) {
        return false;
      }

      const selection = view.state.selection.main;
      const capturedFrom = selection.from;
      const capturedTo = selection.to;
      event.preventDefault();
      event.stopPropagation();

      onImagePaste(items, (markdown) => {
        insertPastedImageMarkdown(view, markdown, capturedFrom, capturedTo);
      });

      return true;
    },
  });
}

function insertPastedImageMarkdown(
  view: EditorView,
  markdown: string,
  from: number,
  to: number,
): void {
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

  // Image decoding and widget replacement can change the viewport after the
  // transaction. Preserve the reader's position without altering document data.
  const restoreScrollAndFocus = (attempt: number): void => {
    view.scrollDOM.scrollTop = beforeScrollTop;
    view.focus();
    if (attempt < 3) {
      window.requestAnimationFrame(() => restoreScrollAndFocus(attempt + 1));
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
  const needsLeadingBreak = beforeText.trim().length > 0;

  return `${needsLeadingBreak ? "\n" : ""}${trimmed}\n`;
}
