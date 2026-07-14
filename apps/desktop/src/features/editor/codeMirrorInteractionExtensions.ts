import { EditorSelection, EditorState, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openExternalUrl } from "../../shared/tauri/openExternalUrl";

const LARGE_ENTER_SCROLL_JUMP_THRESHOLD = 80;

/**
 * Keeps editor-level DOM and selection behavior in CodeMirror extensions,
 * rather than mixing it into the live editor component.
 */
export const trimSingleLineBreakSelectionExtension = EditorState.transactionFilter.of((transaction) => {
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

export const preserveLargeEnterScrollJumpExtension = EditorView.domEventHandlers({
  keydown(event, view) {
    if (event.key !== "Enter" || event.defaultPrevented) {
      return false;
    }

    const scrollDOM = view.scrollDOM;
    const scrollTop = scrollDOM.scrollTop;
    const scrollLeft = scrollDOM.scrollLeft;
    const restoreIfLargeJump = () => {
      if (Math.abs(scrollDOM.scrollTop - scrollTop) > LARGE_ENTER_SCROLL_JUMP_THRESHOLD) {
        scrollDOM.scrollTop = scrollTop;
      }
      if (Math.abs(scrollDOM.scrollLeft - scrollLeft) > LARGE_ENTER_SCROLL_JUMP_THRESHOLD) {
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

export function createLinkClickExtension() {
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
    void openExternalUrl(href);
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
  if (to !== nextLine.from || from > line.to) {
    return null;
  }

  const forward = anchor <= head;
  return {
    anchor: forward ? anchor : line.to,
    head: forward ? line.to : head,
  };
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
