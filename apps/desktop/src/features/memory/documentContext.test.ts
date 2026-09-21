import { describe, expect, it } from "vitest";
import { captureMemoryDocumentContext } from "./documentContext";

describe("Memory document context", () => {
  it("captures exact selected bytes and one-based line bounds", () => {
    const document = "# Retry\n\nNever retry FAILED automatically.\nKeep manual review.";
    const from = document.indexOf("Never");
    const to = document.indexOf("\nKeep");

    expect(captureMemoryDocumentContext({
      fileId: "docs/retry.md",
      workspaceRoot: "/repo",
      relativePath: "docs/retry.md",
      editorRevision: "editor-r1",
      dirty: false,
      editorSnapshot: { markdown: document, from, to },
    })).toEqual({
      fileId: "docs/retry.md",
      workspaceRoot: "/repo",
      relativePath: "docs/retry.md",
      editorRevision: "editor-r1",
      dirty: false,
      selection: {
        from,
        to,
        startLine: 3,
        endLine: 3,
        text: "Never retry FAILED automatically.",
      },
    });

  });

  it("keeps dirty state but omits an empty selection", () => {
    expect(captureMemoryDocumentContext({
      fileId: "docs/retry.md",
      workspaceRoot: "/repo",
      relativePath: "docs/retry.md",
      editorRevision: "editor-r1",
      dirty: true,
      editorSnapshot: { markdown: "# Retry", from: 2, to: 2 },
    })).toEqual({
      fileId: "docs/retry.md",
      workspaceRoot: "/repo",
      relativePath: "docs/retry.md",
      editorRevision: "editor-r1",
      dirty: true,
    });
  });

  it("does not create durable context for an untitled or unsaved document", () => {
    expect(captureMemoryDocumentContext({
      fileId: "untitled:1",
      workspaceRoot: "/repo",
      relativePath: "",
      editorRevision: "",
      dirty: true,
      editorSnapshot: null,
    })).toBeNull();
  });
});
