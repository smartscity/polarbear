import { EditorSelection, Transaction } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { validateMermaidSource } from "../diagram/mermaidRenderer";
import { translateCurrent } from "../../shared/i18n/translate";
import { isSelectionInsideFencedCode } from "./markdown/codeFenceState";

export function isPlainMermaidCandidate(text: string): boolean {
  return /^\s*(?:flowchart|graph)[ \t]+(?:TD|TB|LR|RL|BT)[ \t]*(?:;[ \t]*)?\r?\n\S[\s\S]*$/u.test(text.trim().replace(/\n[ \t]+/g, "\n"))
    && !/^\s*(?:`{3,}|~{3,})/m.test(text);
}

export function mermaidPasteText(view: EditorView, text: string, from: number, to: number, valid: boolean): string {
  if (!valid) return text;
  const before = view.state.sliceDoc(0, from);
  const after = view.state.sliceDoc(to);
  return `${before && !before.endsWith("\n\n") ? before.endsWith("\n") ? "\n" : "\n\n" : ""}`
    + `\`\`\`mermaid\n${text.trim()}\n\`\`\`\n`
    + `${after && !after.startsWith("\n") ? "\n" : ""}`;
}

type PendingPaste = { from: number; to: number; text: string };

/** Validate only explicit flowchart documents; insert each paste as one history event. */
export function createMermaidPasteExtension(onStatus?: (message: string) => void) {
  return ViewPlugin.fromClass(class {
    private pending = new Set<PendingPaste>();
    private sequence: Promise<void> = Promise.resolve();
    private alive = true;
    constructor(private view: EditorView) {}
    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      for (const item of this.pending) {
        item.from = update.changes.mapPos(item.from, 1);
        item.to = Math.max(item.from, update.changes.mapPos(item.to, 1));
      }
    }
    destroy() { this.alive = false; this.pending.clear(); }
    paste(event: ClipboardEvent): boolean {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (event.defaultPrevented || !isPlainMermaidCandidate(text) || this.view.state.selection.ranges.length !== 1
        || isSelectionInsideFencedCode(this.view)
        || (event.target instanceof Element && event.target.closest(".cm-typora-table, [data-table-cell], input, textarea"))) return false;
      event.preventDefault(); event.stopPropagation();
      const { from, to } = this.view.state.selection.main;
      const item: PendingPaste = { from, to, text };
      this.pending.add(item);
      this.sequence = this.sequence.then(async () => {
        const valid = await validateMermaidSource(text).catch(() => false);
        if (!this.alive) return;
        this.pending.delete(item);
        const insert = mermaidPasteText(this.view, text, item.from, item.to, valid);
        this.view.dispatch({ changes: { from: item.from, to: item.to, insert },
          selection: EditorSelection.cursor(item.from + insert.length),
          annotations: [Transaction.userEvent.of("input.paste"), isolateHistory.of("full")],
        });
        if (!valid) onStatus?.(translateCurrent("diagram.pasteInvalid"));
      }).catch(() => { onStatus?.(translateCurrent("diagram.pasteFailed")); });
      return true;
    }
  }, { eventHandlers: { paste(event) { return this.paste(event); } } });
}
