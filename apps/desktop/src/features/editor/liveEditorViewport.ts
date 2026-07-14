const LIVE_VIEWPORT_MIN_HEIGHT = 240;

const LIVE_VIEWPORT_SELECTORS = [
  ".cm-theme",
  ".cm-editor",
  ".cm-scroller",
] as const;

/**
 * Removes the imperative sizing used while the live editor owns the pane.
 * CodeMirror remains the only scroll container after this cleanup.
 */
export function clearLiveEditorViewportSizing(pane: HTMLElement): void {
  pane.style.height = "";
  pane.style.maxHeight = "";
  pane.style.minHeight = "";
  pane.style.overflow = "";
  pane.style.display = "";
  pane.style.flexDirection = "";
  delete pane.dataset.liveViewportHeight;

  for (const selector of LIVE_VIEWPORT_SELECTORS) {
    const element = pane.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
      continue;
    }

    element.style.minHeight = "";
    element.style.height = "";
    element.style.maxHeight = "";
    element.style.overflow = "";
    element.style.overflowX = "";
    element.style.overflowY = "";
    element.style.overscrollBehavior = "";
  }
}

/**
 * Gives CodeMirror a stable layout height without reading a transformed DOM
 * rectangle. The workspace canvas may be visually zoomed, but that transform
 * must never be fed back into CodeMirror's real layout dimensions.
 */
export function sizeLiveEditorViewport(pane: HTMLElement): boolean {
  const title = pane.querySelector(".typora-live-title");
  const theme = pane.querySelector(".cm-theme");
  const editor = pane.querySelector(".cm-editor");
  const scroller = pane.querySelector(".cm-scroller");

  if (!(editor instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
    return false;
  }

  const titleHeight = title instanceof HTMLElement ? title.offsetHeight : 0;
  const viewportHeight = Math.max(
    LIVE_VIEWPORT_MIN_HEIGHT,
    Math.floor(pane.clientHeight - titleHeight),
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

  if (theme instanceof HTMLElement && theme.style.overflow !== "hidden") {
    theme.style.overflow = "hidden";
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
