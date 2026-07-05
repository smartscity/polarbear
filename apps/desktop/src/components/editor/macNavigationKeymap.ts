import { EditorSelection, Prec } from "@codemirror/state";
import { keymap, type EditorView, type KeyBinding } from "@codemirror/view";

export function macNavigationKeymap() {
  return Prec.highest(keymap.of(macNavigationKeyBindings()));
}

export function macNavigationKeyBindings(): KeyBinding[] {
  return [
    {
      key: "Mod-ArrowLeft",
      preventDefault: true,
      run: (view) => moveToLineBoundary(view, "start", false),
    },
    {
      key: "Mod-ArrowRight",
      preventDefault: true,
      run: (view) => moveToLineBoundary(view, "end", false),
    },
    {
      key: "Mod-Shift-ArrowLeft",
      preventDefault: true,
      run: (view) => moveToLineBoundary(view, "start", true),
    },
    {
      key: "Shift-Mod-ArrowLeft",
      preventDefault: true,
      run: (view) => moveToLineBoundary(view, "start", true),
    },
    {
      key: "Mod-Shift-ArrowRight",
      preventDefault: true,
      run: (view) => moveToLineBoundary(view, "end", true),
    },
    {
      key: "Shift-Mod-ArrowRight",
      preventDefault: true,
      run: (view) => moveToLineBoundary(view, "end", true),
    },
    {
      key: "Mod-ArrowUp",
      preventDefault: true,
      run: (view) => moveToDocumentBoundary(view, "start", false),
    },
    {
      key: "Mod-ArrowDown",
      preventDefault: true,
      run: (view) => moveToDocumentBoundary(view, "end", false),
    },
    {
      key: "Mod-Shift-ArrowUp",
      preventDefault: true,
      run: (view) => moveToDocumentBoundary(view, "start", true),
    },
    {
      key: "Shift-Mod-ArrowUp",
      preventDefault: true,
      run: (view) => moveToDocumentBoundary(view, "start", true),
    },
    {
      key: "Mod-Shift-ArrowDown",
      preventDefault: true,
      run: (view) => moveToDocumentBoundary(view, "end", true),
    },
    {
      key: "Shift-Mod-ArrowDown",
      preventDefault: true,
      run: (view) => moveToDocumentBoundary(view, "end", true),
    },
  ];
}

function moveToLineBoundary(
  view: EditorView,
  boundary: "start" | "end",
  extend: boolean,
): boolean {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  const target = boundary === "start" ? line.from : line.to;

  view.dispatch({
    selection: extend
      ? EditorSelection.range(selection.anchor, target)
      : EditorSelection.cursor(target),
    scrollIntoView: true,
    userEvent: "keyboardselection",
  });

  return true;
}

function moveToDocumentBoundary(
  view: EditorView,
  boundary: "start" | "end",
  extend: boolean,
): boolean {
  const selection = view.state.selection.main;
  const target = boundary === "start" ? 0 : view.state.doc.length;

  view.dispatch({
    selection: extend
      ? EditorSelection.range(selection.anchor, target)
      : EditorSelection.cursor(target),
    scrollIntoView: true,
    userEvent: "keyboardselection",
  });

  return true;
}
