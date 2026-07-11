import { describe, expect, it } from "vitest";
import {
  joinWorkspacePath,
  normalizeMarkdownFileName,
  normalizeWorkspacePath,
  remapDocumentMetadataPaths,
  remapPath,
  targetAffectsDirtyFile,
} from "./workspacePaths";

describe("workspacePaths", () => {
  it("normalizes user-entered paths and Markdown extensions", () => {
    expect(normalizeWorkspacePath(" docs \\ guides / start ")).toBe("docs/guides/start");
    expect(normalizeMarkdownFileName(" docs / guide ")).toBe("docs/guide.md");
    expect(joinWorkspacePath("docs", " guides / intro.md ")).toBe("docs/guides/intro.md");
  });

  it("remaps a renamed directory without changing unrelated paths", () => {
    expect(remapPath("docs/guide.md", "docs", "notes")).toBe("notes/guide.md");
    expect(remapPath("assets/logo.png", "docs", "notes")).toBe("assets/logo.png");
    expect(remapDocumentMetadataPaths(
      { tab: "docs/guide.md", other: "assets/logo.png" },
      "docs",
      "notes",
    )).toEqual({ tab: "notes/guide.md", other: "assets/logo.png" });
  });

  it("detects dirty descendants before destructive workspace operations", () => {
    const dirtyFiles = new Set(["docs/guide.md"]);
    expect(targetAffectsDirtyFile("docs", dirtyFiles)).toBe(true);
    expect(targetAffectsDirtyFile("assets", dirtyFiles)).toBe(false);
  });
});
