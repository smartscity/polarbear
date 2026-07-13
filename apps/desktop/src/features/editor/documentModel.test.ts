import { describe, expect, it } from "vitest";
import {
  deriveDefaultMarkdownFileName,
  displayNameForDocumentId,
  extractDocumentStructure,
  findOpenDocumentIdForWorkspaceFile,
  makeWorkspaceDocumentId,
} from "./documentModel";

describe("documentModel", () => {
  it("extracts heading levels and source positions", () => {
    expect(extractDocumentStructure("# One\ntext\n## Two")).toEqual([
      { id: "heading-0-0", label: "One", level: 1, position: 0 },
      { id: "heading-2-11", label: "Two", level: 2, position: 11 },
    ]);
  });

  it("keeps document IDs unique across workspaces", () => {
    const documentId = makeWorkspaceDocumentId({
      currentDocumentIds: new Set(["/workspace-b::README.md"]),
      currentWorkspaceRoot: "/workspace-a",
      relativePath: "README.md",
      workspaceRoot: "/workspace-b",
    });
    expect(documentId).toBe("/workspace-b::README.md#2");
  });

  it("finds an already-open workspace document by root and relative path", () => {
    expect(findOpenDocumentIdForWorkspaceFile(
      ["tab-a", "tab-b"],
      { "tab-a": "/one", "tab-b": "/two" },
      { "tab-a": "README.md", "tab-b": "README.md" },
      "/two",
      "README.md",
    )).toBe("tab-b");
  });

  it("receives the localized untitled label from the UI boundary", () => {
    expect(displayNameForDocumentId("", [], {}, {}, "未命名")).toBe("未命名");
    expect(deriveDefaultMarkdownFileName("", "", "未命名")).toBe("未命名.md");
  });
});
