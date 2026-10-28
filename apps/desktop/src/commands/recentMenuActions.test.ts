import { expect, it, vi } from "vitest";
import { RecentMenuActions } from "./recentMenuActions";
import type { Translate } from "../shared/i18n/I18nProvider";

const t = ((key: string) => key) as Translate;
function state(paths: string[]) {
  return { entries: paths.map((path, index) => ({ path, openedAt: 100 - index })), busy: false, open: vi.fn(), clear: vi.fn() };
}
function click(projection: ReturnType<RecentMenuActions["prepare"]>, index = 0) {
  const item = projection.submenu.items[index];
  if ("action" in item && typeof item.action === "function") item.action();
}

it("keeps visible paths bound during a pending or abandoned reordered installation", () => {
  const owner = new RecentMenuActions();
  const first = state(["/a.md", "/b.md"]), next = state(["/b.md", "/a.md"]);
  const visible = owner.prepare(first, t); visible.activate();
  const pending = owner.prepare(next, t);
  click(pending); expect(next.open).not.toHaveBeenCalled();
  click(visible); expect(first.open).toHaveBeenCalledExactlyOnceWith("/a.md");
  pending.activate(); click(visible); click(pending);
  expect(first.open).toHaveBeenCalledTimes(1);
  expect(next.open).toHaveBeenCalledExactlyOnceWith("/b.md");
});

it("distinguishes duplicate names and bounds action ids across repeated replacements", () => {
  const owner = new RecentMenuActions(), ids = new Set<string>();
  for (let index = 0; index < 60; index++) {
    const projection = owner.prepare(state([`/中文 文件/${index}/notes.md`, `/other/${index}/notes.md`]), t);
    const items = projection.submenu.items;
    expect(items[0]).toMatchObject({ text: `notes.md — /中文 文件/${index}` });
    for (const item of items) if ("id" in item) ids.add(item.id);
    projection.activate();
  }
  expect(ids.size).toBe(5);
});

it("disables both empty history and clear, and disables actions during opening", () => {
  const owner = new RecentMenuActions();
  expect(owner.prepare(state([]), t).submenu.items).toMatchObject([
    { text: "recent.empty", enabled: false }, { item: "Separator" }, { text: "recent.clear", enabled: false },
  ]);
  const busy = owner.prepare({ ...state(["/a.md"]), busy: true }, t);
  expect(busy.submenu.items[0]).toHaveProperty("enabled", false);
  expect(busy.submenu.items.at(-1)).toHaveProperty("enabled", false);
});
