import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { isPlainMermaidCandidate, mermaidPasteText } from "./mermaidPasteExtension";

describe("explicit Mermaid paste candidates", () => {
  it.each(["TD", "TB", "LR", "RL", "BT"])("recognizes complete %s sources without rewriting them", (direction) => {
    expect(isPlainMermaidCandidate(`flowchart ${direction}\n  A[Start] --> B[End]`)).toBe(true);
  });
  it.each(["flowchart is a useful concept", "flowchart TD", "const flowchart = 1;", "```mermaid\nflowchart TD\nA-->B\n```", "```js\nflowchart TD\nA-->B\n```", "# Intro\nflowchart TD\nA-->B"])("does not claim ordinary or already fenced text: %s", (text) => {
    expect(isPlainMermaidCandidate(text)).toBe(false);
  });
  it("keeps invalid sources intact and separates valid blocks from surrounding paragraphs", () => {
    const view = { state: EditorState.create({ doc: "BeforeAfter" }) } as EditorView;
    const source = "flowchart TD\nA-->B";
    expect(mermaidPasteText(view, source, 6, 6, false)).toBe(source);
    expect(mermaidPasteText(view, source, 6, 6, true)).toBe(`\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n`);
  });
});
