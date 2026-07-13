import { describe, expect, it } from "vitest";
import { workspaceTreesEqual, type WorkspaceItem } from "./workspaceModel";

const tree: WorkspaceItem[] = [{
  id: "docs",
  name: "docs",
  type: "folder",
  children: [{ id: "docs/guide.md", name: "guide.md", type: "file" }],
}];

describe("workspaceTreesEqual", () => {
  it("accepts equivalent trees returned from separate filesystem reads", () => {
    expect(workspaceTreesEqual(tree, structuredClone(tree))).toBe(true);
  });

  it("detects nested file additions and renames", () => {
    expect(workspaceTreesEqual(tree, [{
      ...tree[0],
      children: [{ id: "docs/renamed.md", name: "renamed.md", type: "file" }],
    }])).toBe(false);
  });
});
