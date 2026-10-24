import type { EditorView } from "@codemirror/view";
import { NORMAL_APP_ZOOM } from "../../features/zoom/appZoomRuntime";

type CaretHitTestDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => {
    offset: number;
    offsetNode: Node;
  } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

export function resolveEditorPositionAtVisualPointer(
  view: EditorView,
  clientX: number,
  clientY: number,
  scale: number,
): number | null {
  const caretDocument = document as CaretHitTestDocument;
  const caretPosition = caretDocument.caretPositionFromPoint?.(clientX, clientY);
  if (caretPosition && view.contentDOM.contains(caretPosition.offsetNode)) {
    return view.posAtDOM(caretPosition.offsetNode, caretPosition.offset);
  }

  const caretRange = caretDocument.caretRangeFromPoint?.(clientX, clientY);
  if (caretRange && view.contentDOM.contains(caretRange.startContainer)) {
    return view.posAtDOM(caretRange.startContainer, caretRange.startOffset);
  }

  // CodeMirror's block lookup expects an unscaled Y coordinate, while inline
  // glyph hit-testing still uses visual X coordinates. This is only a fallback
  // for WebViews without a DOM caret hit-test API.
  const contentRect = view.contentDOM.getBoundingClientRect();
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : NORMAL_APP_ZOOM;
  return view.posAtCoords({
    x: clientX,
    y: contentRect.top + (clientY - contentRect.top) / safeScale,
  });
}
