import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  cleanup: undefined as (() => void) | undefined,
  owner: undefined as unknown,
  next: 0,
  handles: new Set<number>(),
  options: [] as Array<Record<string, unknown>>,
  installed: [] as number[],
  installStarted: 0,
  createGate: undefined as Promise<void> | undefined,
  installGate: undefined as Promise<void> | undefined,
  failCreate: false,
  failInstall: false,
}));
vi.mock("react", () => ({
  useState: (create: () => unknown) => [fixture.owner ??= create()],
  useEffect: (effect: () => () => void) => { fixture.cleanup = effect(); },
}));
vi.mock("../shared/i18n/I18nProvider", () => ({ useI18n: () => ({ language: "en", t: (key: string) => key }) }));
vi.mock("../shared/settings/useUserSettings", () => ({ useUserSettings: () => ({ keybindings: {} }) }));
vi.mock("./commandState", () => ({ getCommandState: () => ({ enabled: true, checked: false }) }));
vi.mock("./appCommandRegistry", () => ({ titleForCommand: (id: string) => id }));
vi.mock("./keybindingResolver", () => ({ effectiveAcceleratorForCommand: () => undefined }));
vi.mock("@tauri-apps/api/menu", () => {
  const resource = () => {
    const rid = ++fixture.next; fixture.handles.add(rid);
    return { rid, close: async () => {
      if (!fixture.handles.delete(rid)) throw new Error("Resource closed twice");
    } };
  };
  return {
    CheckMenuItem: { new: async () => resource() },
    Menu: { new: async (options: Record<string, unknown>) => {
      await fixture.createGate;
      if (fixture.failCreate) throw new Error("Create failed");
      fixture.options.push(options);
      const menu = resource();
      return { ...menu, setAsAppMenu: async () => {
        fixture.installStarted++;
        await fixture.installGate;
        if (fixture.failInstall) throw new Error("Install failed");
        const previous = fixture.installed.length ? resource() : null;
        fixture.installed.push(menu.rid);
        return previous;
      } };
    } },
  };
});
import { repositoryMenuItems, useNativeAppMenu } from "./useNativeAppMenu";
import type { CommandRuntimeContext } from "./commandState";
import type { Translate } from "../shared/i18n/I18nProvider";

it("offers a native cleanup retry even when account metadata is absent", () => {
  const execute = vi.fn();
  const items = repositoryMenuItems({
    commandContext: { repositoryCleanupPending: true } as CommandRuntimeContext,
    executeCommand: execute, repositoryAccount: null, repositoryBinding: null,
    keybindingOverrides: {}, t: ((key: string) => key) as Translate,
  });
  expect(items).toHaveLength(1);
  expect(items[0].id).toBe("repository.disconnectGithub");
  items[0].action?.();
  expect(execute).toHaveBeenCalledWith("repository.disconnectGithub");
});

function NativeMenuFixture() {
  useNativeAppMenu(vi.fn(), { commandContext: {} as never, repositoryAccount: null, repositoryBinding: null });
}
beforeEach(() => {
  fixture.owner = undefined; fixture.cleanup = undefined; fixture.next = 0;
  fixture.handles.clear(); fixture.options = []; fixture.installed = [];
  fixture.installStarted = 0;
  fixture.createGate = undefined; fixture.installGate = undefined;
  fixture.failCreate = false; fixture.failInstall = false;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => { fixture.cleanup?.(); vi.restoreAllMocks(); });

it("releases every returned native handle across repeated menu replacements", async () => {
  for (let index = 0; index < 12; index++) {
    fixture.cleanup?.(); NativeMenuFixture();
    await vi.waitFor(() => expect(fixture.installed).toHaveLength(index + 1));
    await vi.waitFor(() => expect(fixture.handles.size).toBe(0));
  }
});

it("does not install a menu whose build completed after cleanup", async () => {
  let finish!: () => void;
  fixture.createGate = new Promise((resolve) => { finish = resolve; });
  NativeMenuFixture(); await vi.waitFor(() => expect(fixture.cleanup).toBeDefined());
  fixture.cleanup?.(); finish();
  await vi.waitFor(() => expect(fixture.options).toHaveLength(1));
  await vi.waitFor(() => expect(fixture.handles.size).toBe(0));
  expect(fixture.installed).toHaveLength(0);
});

it("coalesces replacements while an installation is pending", async () => {
  let finish!: () => void;
  fixture.installGate = new Promise((resolve) => { finish = resolve; });
  NativeMenuFixture(); await vi.waitFor(() => expect(fixture.installStarted).toBe(1));
  for (let index = 0; index < 8; index++) { fixture.cleanup?.(); NativeMenuFixture(); }
  finish();
  await vi.waitFor(() => expect(fixture.installed).toHaveLength(2));
  expect(fixture.options).toHaveLength(2);
  await vi.waitFor(() => expect(fixture.handles.size).toBe(0));
});

it.each(["failCreate", "failInstall"] as const)("releases resources and recovers after %s", async (failure) => {
  fixture[failure] = true; NativeMenuFixture();
  await vi.waitFor(() => expect(console.info).toHaveBeenCalled());
  await vi.waitFor(() => expect(fixture.handles.size).toBe(0));
  fixture[failure] = false; fixture.cleanup?.(); NativeMenuFixture();
  await vi.waitFor(() => expect(fixture.installed).toHaveLength(1));
  await vi.waitFor(() => expect(fixture.handles.size).toBe(0));
});

it("uses stable unique action ids so rebuilding does not grow the native channel registry", async () => {
  NativeMenuFixture(); await vi.waitFor(() => expect(fixture.options).toHaveLength(1));
  const ids: string[] = [];
  const visit = (item: Record<string, unknown>) => {
    if (item.action) { expect(typeof item.id).toBe("string"); ids.push(item.id as string); }
    for (const child of (item.items ?? []) as Array<Record<string, unknown>>) visit(child);
  };
  visit(fixture.options[0]);
  expect(ids.length).toBeGreaterThan(30);
  expect(new Set(ids).size).toBe(ids.length);
});
