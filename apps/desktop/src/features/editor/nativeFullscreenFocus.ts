import { ViewPlugin } from "@codemirror/view";
import { APP_EVENTS } from "../../shared/events/appEvents";

/** Reconcile WebKit's range with editor state after AppKit restores its responder. */
export const nativeFullscreenFocus = ViewPlugin.define((view) => {
  const window = view.dom.ownerDocument.defaultView;
  const restore = () => {
    // Search, dialogs and nested editors retain their own focus and selection.
    if (view.root.activeElement !== view.contentDOM || view.composing) return;
    const range = view.state.selection.main;
    const anchor = view.domAtPos(range.anchor);
    const head = view.domAtPos(range.head);
    // view.focus() alone can trust a stale cached DOM range after AppKit focus.
    // Project the authoritative editor selection without a document transaction.
    view.dom.ownerDocument.getSelection()?.setBaseAndExtent(
      anchor.node, anchor.offset, head.node, head.offset,
    );
  };
  window?.addEventListener(APP_EVENTS.nativeFullscreenRestored, restore);
  return {
    destroy() {
      window?.removeEventListener(APP_EVENTS.nativeFullscreenRestored, restore);
    },
  };
});
