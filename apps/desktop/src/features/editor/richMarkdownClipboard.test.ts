import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import {
  buildRichMarkdownClipboardHtml,
  isEntireDocumentSelected,
} from "./richMarkdownClipboard";

describe("rich Markdown clipboard", () => {
  it("replaces Mermaid fences with embedded PNG images", async () => {
    const renderMermaid = vi.fn().mockResolvedValue("data:image/png;base64,diagram");
    const markdown = [
      "# Architecture",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "After the diagram.",
    ].join("\n");

    const html = await buildRichMarkdownClipboardHtml(markdown, renderMermaid);

    expect(renderMermaid).toHaveBeenCalledWith("graph TD\n  A --> B\n", 1);
    expect(html).toContain("<h1>Architecture</h1>");
    expect(html).toContain('src="data:image/png;base64,diagram"');
    expect(html).toContain("After the diagram.");
    expect(html).not.toContain("language-mermaid");
  });

  it("keeps Mermaid source as a code block when image rendering fails", async () => {
    const html = await buildRichMarkdownClipboardHtml(
      "```mermaid\ngraph LR\n  A --> B\n```\n",
      async () => {
        throw new Error("render failed");
      },
    );

    expect(html).toContain('class="language-mermaid"');
    expect(html).toContain("graph LR");
  });

  it("only identifies a complete document selection", () => {
    const document = "# Title\n\nBody";
    const completeView = {
      state: EditorState.create({
        doc: document,
        selection: { anchor: 0, head: document.length },
      }),
    } as EditorView;
    const partialView = {
      state: EditorState.create({
        doc: document,
        selection: { anchor: 0, head: 7 },
      }),
    } as EditorView;

    expect(isEntireDocumentSelected(completeView)).toBe(true);
    expect(isEntireDocumentSelected(partialView)).toBe(false);
  });
});
