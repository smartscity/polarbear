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

  it("renders multiple Mermaid images one at a time", async () => {
    let activeRenders = 0;
    let maximumActiveRenders = 0;
    let completedRenders = 0;
    const renderMermaid = vi.fn(async () => {
      activeRenders += 1;
      maximumActiveRenders = Math.max(maximumActiveRenders, activeRenders);
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeRenders -= 1;
      return `data:image/png;base64,diagram-${completedRenders++}`;
    });

    const html = await buildRichMarkdownClipboardHtml(
      "```mermaid\ngraph TD\nA-->B\n```\n\n```mermaid\nsequenceDiagram\nA->>B: Hi\n```\n",
      renderMermaid,
    );

    expect(renderMermaid).toHaveBeenCalledTimes(2);
    expect(maximumActiveRenders).toBe(1);
    expect(html.indexOf("diagram-0")).toBeLessThan(html.indexOf("diagram-1"));
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
