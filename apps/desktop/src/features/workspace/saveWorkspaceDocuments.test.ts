import { describe, expect, it, vi } from "vitest";
import { saveWorkspaceDocuments } from "./saveWorkspaceDocuments";

function fixture() {
  const contents = new Map([["a", "first"], ["b", "second"]]);
  const dirty = new Set(["a", "b"]);
  return {
    contents, dirty,
    getDirtyDocumentIds: () => [...dirty],
    getContent: (id: string) => contents.get(id),
    saveDocument: vi.fn(async (id: string) => { dirty.delete(id); return true; }),
  };
}

describe("workspace save preflight", () => {
  it("checks the committed identity after Save As and rejects subsequent edits", async () => {
    for (const changed of [false, true]) {
      const state = fixture();
      state.dirty.delete("b");
      const result = await saveWorkspaceDocuments({
        ...state,
        saveDocument: async () => {
          state.contents.delete("a"); state.dirty.delete("a");
          state.contents.set("saved.md", changed ? "new edit" : "first");
          state.dirty.add("saved.md");
          return "saved.md";
        },
      });
      expect(result).toBe(!changed);
    }
  });
  it("saves through the document owner and does not mutate buffers itself", async () => {
    const state = fixture();
    expect(await saveWorkspaceDocuments(state)).toBe(true);
    expect(state.saveDocument.mock.calls).toEqual([["a"], ["b"]]);
    expect(state.contents.get("a")).toBe("first");
  });

  it("stops before later documents when a save is pending, denied or incomplete", async () => {
    const state = fixture();
    state.saveDocument.mockResolvedValue(false);
    expect(await saveWorkspaceDocuments(state)).toBe(false);
    expect(state.saveDocument.mock.calls).toEqual([["a"]]);
    expect([...state.dirty]).toEqual(["a", "b"]);
  });

  it("detects new edits to an earlier document while a later save completes", async () => {
    const state = fixture();
    state.saveDocument.mockImplementation(async (id) => {
      state.dirty.delete(id);
      if (id === "b") { state.contents.set("a", "new edit"); state.dirty.add("a"); }
      return true;
    });
    expect(await saveWorkspaceDocuments(state)).toBe(false);
    expect(state.contents.get("a")).toBe("new edit");
    expect(state.dirty.has("a")).toBe(true);
  });

  it("detects a newly dirty document that was not in the starting batch", async () => {
    const state = fixture();
    state.saveDocument.mockImplementation(async (id) => {
      state.dirty.delete(id); state.dirty.add("c"); state.contents.set("c", "new"); return true;
    });
    expect(await saveWorkspaceDocuments(state)).toBe(false);
  });

  it("accepts committed snapshots before the UI removes their dirty markers", async () => {
    const state = fixture();
    state.saveDocument.mockResolvedValue(true);
    expect(await saveWorkspaceDocuments(state)).toBe(true);
  });

  it("does not save a removed document as an empty buffer", async () => {
    const state = fixture(); state.contents.delete("a");
    expect(await saveWorkspaceDocuments(state)).toBe(false);
    expect(state.saveDocument).not.toHaveBeenCalled();
  });
});
