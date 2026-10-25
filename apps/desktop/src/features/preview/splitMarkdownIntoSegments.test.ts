import { describe, expect, it } from "vitest";
import { splitMarkdownIntoSegments } from "./splitMarkdownIntoSegments";

describe("preview resource boundaries", () => {
  it.each(["```", "````", "~~~"])("keeps image syntax inside a %s code fence literal", (fence) => {
    const source = `${fence}text\n![not an image](private.png)\n${fence}\n`;
    expect(splitMarkdownIntoSegments(source).filter((part) => part.type === "image")).toEqual([]);
  });
  it("keeps inline code and escaped image syntax literal", () => {
    expect(splitMarkdownIntoSegments("`![code](code.png)` \\![escaped](escaped.png)").filter((part) => part.type === "image")).toEqual([]);
  });
  it("recognizes a diagram in a quoted list using the Markdown fence grammar", () => {
    const parts = splitMarkdownIntoSegments("> - Example\n>\n>   ~~~~mermaid\n>   graph TD\n>     A-->B\n>   ~~~~\n");
    expect(parts.filter((part) => part.type === "mermaid")).toMatchObject([{ content: "graph TD\n  A-->B\n" }]);
  });
  it("preserves list, quote, and table ancestry around resources", () => {
    const parts = splitMarkdownIntoSegments("> - Diagram\n>\n>   ~~~mermaid\n>   graph LR\n>   A-->B\n>   ~~~\n\n| Image | Text |\n| --- | --- |\n| ![local](assets/a.png) | after |\n");
    const html = parts.filter((part) => part.type === "html").map((part) => part.content).join("");
    expect(html).toMatch(/<blockquote>\s*<ul>\s*<li>[\s\S]*data-preview-resource="resource-0"[\s\S]*<\/li>\s*<\/ul>\s*<\/blockquote>/);
    expect(html).toContain('<td><span data-preview-resource="resource-1"></span></td>');
    expect(parts.filter((part) => part.type === "image")).toMatchObject([{ src: "assets/a.png", alt: "local" }]);
  });
  it("does not close a longer fence with embedded shorter backticks or execute HTML", () => {
    const parts = splitMarkdownIntoSegments("````markdown\n```mermaid\ngraph TD\nA-->B\n```\n![literal](x.png)\n````\n\n<script>alert(1)</script>\n");
    expect(parts.filter((part) => part.type !== "html")).toHaveLength(0);
    expect(parts[0].content).toContain("&lt;script&gt;");
  });
});
