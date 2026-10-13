import { describe, expect, it, vi } from "vitest";
import { markdownClipboardText } from "./markdownClipboardText";
vi.mock("../../shared/i18n/translate", () => ({ translateCurrent: () => "[Diagram image]" }));

describe("readable clipboard fallback", () => {
  it("preserves headings, ordered lists, table rows and ordinary code without diagram source", () => {
    const text = markdownClipboardText("# Title\n\n1. First\n2. Second\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n```js\nconst value = 1;\n```\n\nAfter");
    expect(text).toContain("Title"); expect(text).toContain("1. First"); expect(text).toContain("2. Second");
    expect(text).toContain("A\tB"); expect(text).toContain("1\t2"); expect(text).toContain("const value = 1;");
    expect(text).not.toContain("flowchart LR"); expect(text).toContain("[Diagram image]"); expect(text).toContain("After");
  });
});
