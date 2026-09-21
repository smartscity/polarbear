import type { MarkdownEditorView } from "../editor/components/MarkdownEditor";

export type MemoryDocumentSelection = {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  text: string;
};

export type MemoryDocumentContext = {
  fileId: string;
  workspaceRoot: string;
  relativePath: string;
  editorRevision: string;
  dirty: boolean;
  selection?: MemoryDocumentSelection;
};

export type MemoryEditorSnapshot = {
  markdown: string;
  from: number;
  to: number;
};

type DocumentContextInput = {
  fileId: string;
  workspaceRoot: string;
  relativePath: string;
  editorRevision: string;
  dirty: boolean;
  editorSnapshot: MemoryEditorSnapshot | null;
};

export function snapshotMemoryEditor(
  editorView: MarkdownEditorView | null,
): MemoryEditorSnapshot | null {
  if (!editorView) return null;
  const range = editorView.state.selection.main;
  return {
    markdown: editorView.state.doc.toString(),
    from: range.from,
    to: range.to,
  };
}

export function captureMemoryDocumentContext(
  input: DocumentContextInput,
): MemoryDocumentContext | null {
  if (
    !input.fileId
    || !input.workspaceRoot
    || !input.relativePath
    || !input.editorRevision
  ) {
    return null;
  }

  const selection = selectionFromSnapshot(input.editorSnapshot);
  return {
    fileId: input.fileId,
    workspaceRoot: input.workspaceRoot,
    relativePath: input.relativePath,
    editorRevision: input.editorRevision,
    dirty: input.dirty,
    ...(selection ? { selection } : {}),
  };
}

function selectionFromSnapshot(
  snapshot: MemoryEditorSnapshot | null,
): MemoryDocumentSelection | undefined {
  if (!snapshot || snapshot.from === snapshot.to) return undefined;

  const from = Math.min(snapshot.from, snapshot.to);
  const to = Math.max(snapshot.from, snapshot.to);
  const prefix = snapshot.markdown.slice(0, from);
  const selected = snapshot.markdown.slice(from, to);
  const startLine = prefix.split("\n").length;
  const endLine = startLine + selected.replace(/\n$/u, "").split("\n").length - 1;
  return {
    from,
    to,
    startLine,
    endLine,
    text: selected,
  };
}
