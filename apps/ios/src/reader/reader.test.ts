import { describe, expect, it } from "vitest";
import { renderReaderMarkdown } from "@polarbear/reader-core";
import { resolveDocumentPath } from "@polarbear/reader-core/paths";
import { parseReadingSettings } from "./readingState";
import { readerErrorKey } from "../library/library";

describe("offline reader document model", () => {
  it("preserves inline images inside tables and links without splitting paragraphs", () => {
    const result = renderReaderMarkdown("| Item | Image |\n| --- | --- |\n| [Guide](guide.md) | ![Map](img/map.png) |\n");
    expect(result.images).toEqual([{ id: "reader-image-0", source: "img/map.png", alt: "Map" }]);
    expect(result.html).toContain('<td><span data-reader-image="reader-image-0"></span></td>');
    expect(result.html).toContain('href="guide.md"');
  });
  it("does not interpret code samples as images or diagrams", () => {
    const result = renderReaderMarkdown("````text\n![x](private.png)\n```mermaid\ngraph TD\n```\n````");
    expect(result.images).toHaveLength(0); expect(result.diagrams).toHaveLength(0);
  });
  it("recognizes tilde fences and preserves diagram sources", () => {
    const result = renderReaderMarkdown("~~~mermaid\ngraph TD\n A-->B\n~~~\n\n```puml\n@startuml\nAlice -> Bob\n@enduml\n```");
    expect(result.diagrams.map((d) => d.language)).toEqual(["mermaid", "plantuml"]);
    expect(result.diagrams[0].source).toContain("A-->B");
  });
  it("keeps reference images and links and never creates external image requests", () => {
    const result = renderReaderMarkdown("![image][asset]\n\n[asset]: https://example.com/private.png");
    expect(result.images[0].source).toBe("https://example.com/private.png");
    expect(result.html).not.toContain("<img");
  });
  it("escapes arbitrary HTML while preserving compatible cell line breaks", () => {
    const result = renderReaderMarkdown('<script>alert(1)</script>\n\n| A |\n| --- |\n| First<br>Second |');
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("First<br>");
  });
  it("creates stable unicode heading anchors and distinguishes duplicate headings", () => {
    const result = renderReaderMarkdown("# 中文 Hello\n\n## 中文 Hello\n");
    expect(result.headings.map((h) => h.id)).toEqual(["中文-hello", "中文-hello-1"]);
  });
  it("renders tasks only in lists, without writable controls", () => {
    const result = renderReaderMarkdown("- [x] Done\n- [ ] Next\n\n[x] ordinary paragraph");
    expect(result.html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(result.html).toContain("disabled checked");
    expect(result.html).toContain("[x] ordinary paragraph");
  });
});

describe("collection path confinement", () => {
  it("resolves sibling and parent resources within the collection", () => {
    expect(resolveDocumentPath("docs/read me.md", "../images/%E4%B8%AD.png")).toBe("images/中.png");
    expect(resolveDocumentPath("docs/read.md", "next.md#intro")).toBe("docs/next.md");
  });
  it.each(["../../secret", "%2e%2e/%2e%2e/private", "/etc/passwd", "file:///private", "https://example.com/a", "//example.com/a", "javascript:alert(1)", "data:image/png,a", "..\\a", "%00x", "%ZZ", "%2fetc/passwd"])("rejects unsafe reference %s", (reference) => {
    expect(resolveDocumentPath("docs/read.md", reference)).toBeNull();
  });
});

describe("reader settings", () => {
  it("preserves structured native error codes for localization", () => {
    expect(readerErrorKey({ message: "invalidEncoding" })).toBe("reader.error.invalidEncoding");
    expect(readerErrorKey(new Error("tooLarge"))).toBe("reader.error.tooLarge");
    expect(readerErrorKey({ unexpected: true })).toBe("reader.error.unavailable");
  });
  it("uses safe defaults for missing and non-finite values", () => {
    expect(parseReadingSettings(null)).toEqual({ fontSize: 18, lineHeight: 1.8, theme: "system" });
    expect(parseReadingSettings({ fontSize: NaN, lineHeight: Infinity })).toEqual(parseReadingSettings(null));
  });
  it("bounds large text without changing document contents", () => {
    expect(parseReadingSettings({ fontSize: 90, lineHeight: 0, theme: "dark" })).toEqual({ fontSize: 28, lineHeight: 1.4, theme: "dark" });
  });
});
