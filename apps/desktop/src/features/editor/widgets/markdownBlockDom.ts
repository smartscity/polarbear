import { EditorView } from "@codemirror/view";

type MarkdownBlockMetadata = {
  from?: number;
  id: string;
  to?: number;
  type: string;
};

type PendingEditorMeasure = {
  interactionVersion: number;
  remainingFrames: number;
  scrollLeft: number;
  scrollTop: number;
};

type EditorMeasureState = {
  interactionVersion: number;
  pending: PendingEditorMeasure | null;
  scheduled: boolean;
};

const editorMeasureStates = new WeakMap<EditorView, EditorMeasureState>();

export function markMarkdownPreviewBlock(
  element: HTMLElement,
  block: MarkdownBlockMetadata,
  className?: string,
): void {
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

export function revealMarkdownBlockSource(dom: HTMLElement, from: number): void {
  const view = EditorView.findFromDOM(dom);
  if (!view) {
    return;
  }

  view.dispatch({
    selection: { anchor: from },
    scrollIntoView: true,
  });
  view.focus();
}

export function allowEditorVerticalScroll(element: HTMLElement): void {
  element.dataset.allowNativeEditorWheel = "true";
}

/**
 * Widget content such as images and diagrams can change size after the
 * CodeMirror transaction completes. Re-measure while keeping the current
 * reading position stable.
 */
export function scheduleEditorMeasureFromDom(element: HTMLElement): void {
  const view = EditorView.findFromDOM(element);
  if (!view) {
    return;
  }

  const state = editorMeasureStateFor(view);
  const scrollDOM = view.scrollDOM;
  state.pending = {
    interactionVersion: state.interactionVersion,
    remainingFrames: 2,
    scrollLeft: scrollDOM.scrollLeft,
    scrollTop: scrollDOM.scrollTop,
  };

  if (state.scheduled) {
    return;
  }

  state.scheduled = true;
  view.requestMeasure();

  const restoreAfterFrame = () => {
    const pending = state.pending;
    if (!pending) {
      state.scheduled = false;
      return;
    }

    if (state.interactionVersion === pending.interactionVersion) {
      scrollDOM.scrollTop = pending.scrollTop;
      scrollDOM.scrollLeft = pending.scrollLeft;
    }

    pending.remainingFrames -= 1;
    if (pending.remainingFrames > 0) {
      window.requestAnimationFrame(restoreAfterFrame);
      return;
    }

    state.pending = null;
    state.scheduled = false;
  };

  window.requestAnimationFrame(restoreAfterFrame);
}

function editorMeasureStateFor(view: EditorView): EditorMeasureState {
  const existing = editorMeasureStates.get(view);
  if (existing) {
    return existing;
  }

  const state: EditorMeasureState = {
    interactionVersion: 0,
    pending: null,
    scheduled: false,
  };
  const recordInteraction = () => {
    state.interactionVersion += 1;
  };

  for (const eventName of ["keydown", "pointerdown", "touchstart", "wheel"] as const) {
    view.scrollDOM.addEventListener(eventName, recordInteraction, {
      capture: true,
      passive: true,
    });
  }

  editorMeasureStates.set(view, state);
  return state;
}
