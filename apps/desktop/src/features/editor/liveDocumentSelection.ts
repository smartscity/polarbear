import { EditorSelection, StateEffect, type EditorState, type SelectionRange } from "@codemirror/state";
import { Direction, EditorView, RectangleMarker, ViewPlugin, layer } from "@codemirror/view";

type DocumentRange = { from: number; to: number };
type Rectangle = { left: number; top: number; right: number; bottom: number };

export type SelectedLineRange = DocumentRange & { newlineSelected: boolean };

const selectionGeometryChanged = StateEffect.define<null>();
const geometryObservers = new WeakMap<EditorView, {
  observer: ResizeObserver;
  targets: Set<Element>;
}>();

/** Split only visible source into lines, leaving replaced preview blocks to their own markers. */
export function selectedVisibleLineRanges(
  state: EditorState,
  visibleRanges: readonly DocumentRange[],
): SelectedLineRange[] {
  const result: SelectedLineRange[] = [];
  for (const selection of state.selection.ranges) {
    if (selection.empty) continue;
    for (const visible of visibleRanges) {
      const from = Math.max(selection.from, visible.from);
      const to = Math.min(selection.to, visible.to);
      for (let position = from; position < to;) {
        const line = state.doc.lineAt(position);
        result.push({
          from: position,
          to: Math.min(line.to, to),
          newlineSelected: line.to < to,
        });
        position = line.to + 1;
      }
    }
  }
  return result;
}

export function selectionIntersectsBlock(
  ranges: readonly SelectionRange[],
  block: DocumentRange,
): boolean {
  return Number.isFinite(block.from) && Number.isFinite(block.to) && block.to > block.from &&
    ranges.some((range) => !range.empty && range.from < block.to && range.to > block.from);
}

export function clipSelectionRectangle(rect: Rectangle, bounds: Rectangle): Rectangle | null {
  const clipped = {
    left: Math.max(rect.left, bounds.left),
    top: Math.max(rect.top, bounds.top),
    right: Math.min(rect.right, bounds.right),
    bottom: Math.min(rect.bottom, bounds.bottom),
  };
  return clipped.right > clipped.left && clipped.bottom > clipped.top ? clipped : null;
}

function selectionBase(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect();
  const left = view.textDirection === Direction.LTR
    ? rect.left
    : rect.right - view.scrollDOM.clientWidth * view.scaleX;
  // Layer markers use screen-scaled coordinates. CodeMirror applies the inverse scale itself.
  return {
    left: left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  };
}

function renderedLine(view: EditorView, range: DocumentRange): HTMLElement | null {
  for (const [position, side] of [[range.from, 1], [range.to, -1]] as const) {
    const node = view.domAtPos(position, side).node;
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    const line = element?.closest<HTMLElement>(".cm-line");
    if (line && view.contentDOM.contains(line)) return line;
  }
  return null;
}

function documentSelectionMarkers(view: EditorView): RectangleMarker[] {
  const blocks = view.contentDOM.querySelectorAll<HTMLElement>("[data-markdown-block-from][data-markdown-block-to]");
  const geometry = geometryObservers.get(view);
  if (geometry) {
    const targets = new Set<Element>([view.contentDOM, ...blocks]);
    for (const old of geometry.targets) {
      if (!targets.has(old)) geometry.observer.unobserve(old);
    }
    for (const target of targets) {
      if (!geometry.targets.has(target)) geometry.observer.observe(target);
    }
    geometry.targets = targets;
  }
  if (view.state.selection.ranges.every((range) => range.empty)) return [];
  const markers: RectangleMarker[] = [];
  const base = selectionBase(view);

  for (const range of selectedVisibleLineRanges(view.state, view.visibleRanges)) {
    const line = renderedLine(view, range);
    if (!line) continue;
    const lineRect = line.getBoundingClientRect();
    const bounds = {
      left: lineRect.left - base.left,
      right: lineRect.right - base.left,
      top: lineRect.top - base.top,
      bottom: lineRect.bottom - base.top,
    };
    const pieces = range.from < range.to
      ? RectangleMarker.forRange(view, "cm-live-text-selection", EditorSelection.range(range.from, range.to))
      : [];
    for (const piece of pieces) {
      const clipped = clipSelectionRectangle({
        left: piece.left,
        right: piece.left + (piece.width ?? 0),
        top: piece.top,
        bottom: piece.top + piece.height,
      }, bounds);
      if (clipped) {
        markers.push(new RectangleMarker("cm-live-text-selection", clipped.left, clipped.top,
          clipped.right - clipped.left, clipped.bottom - clipped.top));
      }
    }
    if (range.from === range.to && range.newlineSelected) {
      const caret = view.coordsAtPos(range.from);
      if (caret) {
        markers.push(new RectangleMarker("cm-live-text-selection", caret.left - base.left,
          caret.top - base.top, view.defaultCharacterWidth * view.scaleX * 0.5, caret.bottom - caret.top));
      }
    }
  }

  for (const block of blocks) {
    if (!selectionIntersectsBlock(view.state.selection.ranges, {
      from: Number(block.dataset.markdownBlockFrom),
      to: Number(block.dataset.markdownBlockTo),
    })) continue;
    // Keep editor chrome outside the document selection surface.
    const surface = block.querySelector<HTMLElement>(".cm-typora-diagram-content, .cm-typora-table-scrollport") ?? block;
    const rect = surface.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      markers.push(new RectangleMarker("cm-live-block-selection", rect.left - base.left,
        rect.top - base.top, rect.width, rect.height));
    }
  }
  return markers;
}

/** Nested table editing owns its DOM selection without changing the document's selection. */
const widgetSelectionOwner = ViewPlugin.define((view) => {
  const sync = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    const widget = element?.closest("[data-markdown-block-from]");
    view.dom.dataset.liveWidgetSelection = String(Boolean(widget && view.contentDOM.contains(widget)));
  };
  // WidgetType.ignoreEvent also excludes CodeMirror event observers, so listen
  // on the outer editor in capture phase without intercepting widget events.
  const focusIn = (event: FocusEvent) => sync(event.target);
  const focusOut = (event: FocusEvent) => sync(event.relatedTarget);
  view.dom.addEventListener("focusin", focusIn, true);
  view.dom.addEventListener("focusout", focusOut, true);
  sync(view.root.activeElement);
  return {
    destroy() {
      view.dom.removeEventListener("focusin", focusIn, true);
      view.dom.removeEventListener("focusout", focusOut, true);
      delete view.dom.dataset.liveWidgetSelection;
    },
  };
});

export const liveDocumentSelection = [
  widgetSelectionOwner,
  EditorView.editorAttributes.of((view) => ({
    "data-live-document-selection": String(view.state.selection.ranges.some((range) => !range.empty)),
  })),
  layer({
    above: true,
    class: "cm-live-selection-layer",
    markers: documentSelectionMarkers,
    update: (update) => update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged ||
      update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(selectionGeometryChanged))),
    mount(_dom, view) {
      // An async diagram may grow without changing the editor's minimum height.
      // Observe its own box so selection markers still follow the new layout.
      const observer = new ResizeObserver(() => {
        if (geometryObservers.has(view)) view.dispatch({ effects: selectionGeometryChanged.of(null) });
      });
      geometryObservers.set(view, { observer, targets: new Set() });
    },
    destroy(_dom, view) {
      geometryObservers.get(view)?.observer.disconnect();
      geometryObservers.delete(view);
    },
  }),
];
