import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { collectPreviewBlocks } from "./previewBlocks";

const table = "| A | B |\n| --- | --- |\n| one | two |";
const collect = (doc: string) => collectPreviewBlocks(EditorState.create({ doc }));

describe("live preview source ownership", () => {
  it("returns ordered exact source ranges without altering Markdown", () => {
    const source = `Before\n\n---\n\n$$\nx^2\n$$\n\n> [!TIP] Title\n> Text\n\n${table}\n\n![alt](image.png)\n\n<img src="image.png">\n\nAfter`;
    const blocks = collect(source);
    expect(blocks.map((block) => block.type)).toEqual(["hr", "math", "blockquoteCallout", "table", "image", "htmlImage"]);
    for (const [index, block] of blocks.entries()) {
      expect(source.slice(block.from, block.to)).toBe(block.raw);
      if (index) expect(block.from).toBeGreaterThan(blocks[index - 1].to);
    }
    expect(blocks.find((block) => block.type === "table")?.raw).toBe(table);
  });

  it.each(["```markdown", "~~~text", "````markdown"])("treats %s as an opaque code body", (opening) => {
    const closing = opening.match(/^[`~]+/)![0];
    const body = `${table}\n![alt](image.png)\n> [!NOTE]\n> Text\n---\n$$\nx^2\n$$`;
    expect(collect(`${opening}\n${body}\n${closing}`)).toEqual([]);
    expect(collect(`${opening}\n${body}\n${closing}\n\n${table}`).map((block) => block.raw)).toEqual([table]);
  });

  it("does not interpret unfinished code bodies or inner shorter fences", () => {
    expect(collect(`\`\`\`markdown\n${table}`)).toEqual([]);
    expect(collect(`\`\`\`\`markdown\n\`\`\`mermaid\nflowchart TD\nA-->B\n\`\`\`\n${table}\n\`\`\`\``)).toEqual([]);
  });

  it.each(["mermaid", "plantuml", "puml", "uml"])("preserves the complete %s fence and inner source", (language) => {
    const raw = `\`\`\`${language}\nfirst\nsecond\n\`\`\``;
    const [block] = collect(raw);
    expect(block).toMatchObject({ raw, source: "first\nsecond", language, type: language === "mermaid" ? "mermaid" : "plantuml", from: 0, to: raw.length });
  });

  it("excludes frontmatter and does not treat an isolated pipe row as a table", () => {
    expect(collect(`---\n${table}\n---\n\n| not | a table |`)).toEqual([]);
  });

  it("keeps block identities deterministic and remaps offsets after a prefix edit", () => {
    const source = `Before\n\n${table}`;
    const first = collect(source)[0];
    expect(collect(source)[0]).toEqual(first);
    const shifted = collect("New\n" + source)[0];
    expect(shifted.from).toBe(first.from + 4);
    expect(shifted.raw).toBe(first.raw);
    expect(shifted.id).not.toBe(first.id);
  });
});
