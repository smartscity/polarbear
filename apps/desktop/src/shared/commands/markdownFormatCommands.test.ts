import { describe, expect, it } from "vitest";
import {
  isMarkdownFormatCommand,
  MARKDOWN_FORMAT_COMMANDS,
} from "./markdownFormatCommands";

describe("Markdown format commands", () => {
  it("contains only commands backed by a Markdown text transaction", () => {
    expect(MARKDOWN_FORMAT_COMMANDS).toContain("format.bold");
    expect(MARKDOWN_FORMAT_COMMANDS).toContain("format.taskList");
    expect(isMarkdownFormatCommand("format.codeFence")).toBe(true);
    expect(isMarkdownFormatCommand("format.insertImage")).toBe(false);
    expect(isMarkdownFormatCommand("editor.insertTable")).toBe(false);
  });
});
