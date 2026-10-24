import { describe, expect, it } from "vitest";
import { WorkspacePathMutations, remapWorkspaceDocumentPaths, remapWorkspaceTree } from "./workspacePathMutations";

describe("workspace path mutation ownership", () => {
  it("invalidates pre-mutation reads even after the mutation finishes", () => {
    const owner = new WorkspacePathMutations(), old = owner.readPermission();
    expect(old()).toBe(true); const release = owner.begin("/one")!;
    expect(owner.readPermission()()).toBe(false); release(); expect(old()).toBe(false);
    expect(owner.readPermission()()).toBe(true);
  });
  it("moves a subtree projection without leaving stale paths after refresh failure", () => {
    expect(remapWorkspaceTree([
      { id: "dir", name: "dir", type: "folder", children: [{ id: "dir/a.md", name: "a.md", type: "file" }] },
      { id: "target", name: "target", type: "folder", children: [] },
    ], "dir", "target/moved")).toEqual([
      { id: "target", name: "target", type: "folder", children: [{ id: "target/moved", name: "moved", type: "folder", children: [{ id: "target/moved/a.md", name: "a.md", type: "file", children: undefined }] }] },
    ]);
  });
  it("preserves opaque IDs and other roots when a folder moves", () => {
    expect(remapWorkspaceDocumentPaths(
      { "opaque::1": "dir/a.md", "opaque::2": "dir/nested/b.md", "dir/a.md": "dir/a.md", sibling: "dir2/a.md" },
      { "opaque::1": "/one", "opaque::2": "/one", "dir/a.md": "/two", sibling: "/one" }, "/one", "dir", "target",
    )).toEqual({ "opaque::1": "target/a.md", "opaque::2": "target/nested/b.md", "dir/a.md": "dir/a.md", sibling: "dir2/a.md" });
  });
  it("rejects overlap and releases exactly once without clearing a later lease", () => {
    const owner = new WorkspacePathMutations(); const release = owner.begin("/one")!;
    expect(owner.affects("/one")).toBe(true); expect(owner.affects("/two")).toBe(false);
    expect(owner.begin("/two")).toBeNull(); release();
    const next = owner.begin("/two")!; release(); expect(owner.isBusy()).toBe(true); next(); expect(owner.isBusy()).toBe(false);
  });
});
