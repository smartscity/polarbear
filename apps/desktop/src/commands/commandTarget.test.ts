import { describe, expect, it } from "vitest";
import { resolveFileCommandTarget } from "./commandTarget";

describe("resolveFileCommandTarget", () => {
  const base = {
    activeFileId: "open.md",
    selectedTreeItemId: "selected.md",
  };

  it("prioritizes the explicit context-menu target", () => {
    expect(resolveFileCommandTarget({ ...base, targetPath: "folder" })).toBe("folder");
  });

  it("uses the selected file tree item before the active document", () => {
    expect(resolveFileCommandTarget(base)).toBe("selected.md");
  });

  it("falls back to the active document when the tree has no selection", () => {
    expect(resolveFileCommandTarget({ ...base, selectedTreeItemId: "" })).toBe("open.md");
  });
});
