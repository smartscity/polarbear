import { describe, expect, it } from "vitest";
import { RecentDocumentStore, documentHistoryPath, parseRecentDocuments } from "./recentDocuments";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("RecentDocumentStore", () => {
  it("remaps only the moved subtree while retaining timestamps and deduplicating", () => {
    const store = new RecentDocumentStore(storage());
    store.record("/one/dir/a.md", 1); store.record("/two/dir/a.md", 2);
    store.record("/one/dir2/b.md", 3); store.record("/one/moved/a.md", 4);
    store.remap("/one", "dir", "moved");
    expect(store.read()).toEqual([
      { path: "/one/moved/a.md", openedAt: 4 }, { path: "/one/dir2/b.md", openedAt: 3 }, { path: "/two/dir/a.md", openedAt: 2 },
    ]);
  });
  it("deduplicates, orders and restores the last twenty successful opens", () => {
    const disk = storage();
    const store = new RecentDocumentStore(disk);
    for (let index = 0; index < 25; index++) store.record(`/workspace/${index}.md`, index);
    store.record("/workspace/10.md", 100);
    const restored = new RecentDocumentStore(disk).read();
    expect(restored).toHaveLength(20);
    expect(restored[0]).toEqual({ path: "/workspace/10.md", openedAt: 100 });
    expect(restored.filter((entry) => entry.path === "/workspace/10.md")).toHaveLength(1);
    expect(restored.at(-1)?.openedAt).toBe(5);
  });
  it("removes individual records and clears persisted history without accessing files", () => {
    const disk = storage(); const store = new RecentDocumentStore(disk);
    store.record("/a.md", 1); store.record("/b.md", 2); store.remove("/a.md");
    expect(new RecentDocumentStore(disk).read().map((entry) => entry.path)).toEqual(["/b.md"]);
    store.clear(); expect(new RecentDocumentStore(disk).read()).toEqual([]);
  });
  it("keeps case-sensitive paths, spaces and Unicode while rejecting invalid records", () => {
    expect(documentHistoryPath("/Users/Shared/", "中文 / My Notes.md")).toBe("/Users/Shared/中文 / My Notes.md");
    expect(documentHistoryPath("C:\\Notes", "File.md")).toBe("C:/Notes/File.md");
    expect(parseRecentDocuments([{ path: "/A.md", openedAt: 1 }, { path: "/a.md", openedAt: 2 }, { path: "relative.md", openedAt: 3 }, { path: "/bad.md", openedAt: Infinity }])).toHaveLength(2);
  });
  it("reports storage failures without notifying subscribers of an uncommitted write", () => {
    let notified = false;
    const store = new RecentDocumentStore({ getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); } }, () => { notified = true; });
    expect(() => store.record("/a.md")).toThrow("Quota exceeded"); expect(notified).toBe(false);
  });
  it("reads changes from other windows and tolerates malformed history", () => {
    const disk = storage(); const first = new RecentDocumentStore(disk); const second = new RecentDocumentStore(disk);
    first.record("/a.md", 1); second.record("/b.md", 2);
    expect(first.read()).toHaveLength(2);
    expect(new RecentDocumentStore({ ...disk, getItem: () => "{invalid" }).read()).toEqual([]);
  });
});
