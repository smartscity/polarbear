import { expect, it } from "vitest";
import { projectWorkspaceEntry, removeWorkspaceEntry, planDeletedDocuments } from "./workspaceEntryCompletion";

it("projects nested creation idempotently and removes only the target subtree", () => {
  const tree = [{ id: "notes", name: "notes", type: "folder" as const, children: [] }];
  const item = { id: "notes/new.md", name: "new.md", type: "file" as const };
  const added = projectWorkspaceEntry(tree, item);
  expect(projectWorkspaceEntry(added, item)).toEqual(added);
  expect(removeWorkspaceEntry(added, "notes/new.md")).toEqual(tree);
  expect(removeWorkspaceEntry(added, "notes")).toEqual([]);
});

it("deletion planning retains late edits and same-named documents in another root", () => {
  expect(planDeletedDocuments({
    root: "/one", path: "notes", currentRoot: "/two",
    openIds: ["clean", "dirty", "other", "sibling"], dirtyIds: new Set(["dirty"]),
    roots: { clean: "/one", dirty: "/one", other: "/two", sibling: "/one" },
    paths: { clean: "notes/a.md", dirty: "notes/sub/b.md", other: "notes/a.md", sibling: "notes2/c.md" },
  })).toEqual({ closed: new Set(["clean"]), retained: ["dirty"] });
});
