import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitSettings } from "./settingsDatabase";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  DEFAULT_USER_SETTINGS,
  parseUserSettings,
  USER_SETTINGS_VERSION,
  readUserSettings,
  updateUserSettings,
} from "./userSettings";

afterEach(() => vi.unstubAllGlobals());
const database = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("./settingsDatabase", () => ({
  cachedSettings: () => database.value,
  initializeSettings: vi.fn(),
  commitSettings: vi.fn(async (seed: () => unknown, update: (value: unknown) => unknown) => {
    const next = update(database.value ?? seed());
    database.value = structuredClone(next);
    window.dispatchEvent(new CustomEvent("polarbear-settings-changed"));
    return next;
  }),
}));
beforeEach(() => { database.value = undefined; vi.clearAllMocks(); });

describe("settings persistence", () => {
  function mockWindow() {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, dispatchEvent: vi.fn() });
    let tail = Promise.resolve();
    vi.stubGlobal("navigator", { locks: { request: (_name: string, _options: unknown, action: () => void) => {
      const next = tail.then(action);
      tail = next.catch(() => {});
      return next;
    } } });
    return values;
  }
  it("does not overwrite explicit system preferences with legacy values on restart", async () => {
    const values = mockWindow();
    values.set(STORAGE_KEYS.legacyLanguage, "zh-CN"); values.set(STORAGE_KEYS.legacyTheme, "dark");
    expect(readUserSettings().theme).toBe("dark");
    await updateUserSettings({ theme: "system", language: "system", selectionTranslation: false });
    expect(readUserSettings()).toMatchObject({ theme: "system", language: "system", selectionTranslation: false });
  });
  it("preserves caption preferences and keybindings when updating another setting", async () => {
    mockWindow();
    await updateUserSettings({ caption: { ...DEFAULT_USER_SETTINGS.caption, source: "microphone" }, keybindings: { "caption.start": "Mod+Alt+L" } });
    await updateUserSettings({ selectionTranslation: false });
    expect(readUserSettings()).toMatchObject({ caption: { source: "microphone" }, keybindings: { "caption.start": "Mod+Alt+L" }, selectionTranslation: false });
  });
  it("defaults caption translation off and persists a new explicit opt-in", async () => {
    const values = mockWindow();
    expect(readUserSettings().caption).toMatchObject({ showChinese: false, language: "english" });
    values.set(STORAGE_KEYS.settings, JSON.stringify({ version: 3, theme: "dark", caption: { showChinese: true, source: "microphone" } }));
    expect(readUserSettings()).toMatchObject({ theme: "dark", caption: { source: "microphone", showChinese: false } });
    await updateUserSettings({ caption: { ...readUserSettings().caption, showChinese: true } });
    await updateUserSettings({ theme: "light" });
    expect(readUserSettings().caption.showChinese).toBe(true);
    await updateUserSettings({ caption: { ...readUserSettings().caption, showChinese: false } });
    expect(readUserSettings().caption.showChinese).toBe(false);
  });
  it("merges concurrent nested intent without replacing unrelated preferences or bindings", async () => {
    mockWindow();
    await Promise.all([
      updateUserSettings({ caption: { source: "microphone" }, layout: { leftWidth: 320 }, keybindings: { "file.save": "Mod+Alt+S" } }),
      updateUserSettings({ caption: { showChinese: true }, layout: { rightOpen: true }, keybindings: { "caption.start": null } }),
    ]);
    expect(readUserSettings()).toMatchObject({ caption: { source: "microphone", showChinese: true },
      layout: { leftWidth: 320, rightOpen: true }, keybindings: { "file.save": "Mod+Alt+S", "caption.start": null } });
    await updateUserSettings({ keybindings: { "file.save": undefined } });
    expect(readUserSettings().keybindings).toEqual({ "caption.start": null });
  });
  it("reads the latest snapshot inside the cross-context lock and snapshots caller intent", async () => {
    const values = mockWindow();
    const patch = { caption: { showChinese: true } };
    const pending = updateUserSettings(patch);
    patch.caption.showChinese = false;
    values.set(STORAGE_KEYS.settings, JSON.stringify({ ...DEFAULT_USER_SETTINGS, theme: "dark", caption: { ...DEFAULT_USER_SETTINGS.caption, source: "microphone" } }));
    await pending;
    expect(readUserSettings()).toMatchObject({ theme: "dark", caption: { source: "microphone", showChinese: true } });
  });
  it("rejects unavailable locking without an unsafe write or success notification", async () => {
    const values = mockWindow();
    vi.stubGlobal("navigator", {});
    await expect(Promise.resolve().then(() => updateUserSettings({ theme: "dark" }))).rejects.toThrow();
    expect(values.size).toBe(0);
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });
  it("releases the lock after failed persistence and only announces acknowledged writes", async () => {
    mockWindow();
    vi.mocked(commitSettings).mockRejectedValueOnce(new Error("Storage full"));
    await expect(Promise.resolve().then(() => updateUserSettings({ theme: "dark" }))).rejects.toThrow("Storage full");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
    await updateUserSettings({ language: "zh-CN" });
    expect(readUserSettings()).toMatchObject({ theme: "system", language: "zh-CN" });
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite persisted settings when the read fails inside the lock", async () => {
    mockWindow();
    await updateUserSettings({ theme: "dark" });
    vi.mocked(commitSettings).mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(updateUserSettings({ language: "zh-CN" })).rejects.toThrow("Storage unavailable");
    expect(readUserSettings()).toMatchObject({ theme: "dark", language: "system" });
  });
  it("orders same-field updates and preserves other fields when restoring defaults", async () => {
    mockWindow();
    await Promise.all([updateUserSettings({ theme: "dark", caption: { source: "microphone" } }), updateUserSettings({ theme: "light" })]);
    expect(readUserSettings()).toMatchObject({ theme: "light", caption: { source: "microphone" } });
    await updateUserSettings({ layout: DEFAULT_USER_SETTINGS.layout });
    expect(readUserSettings()).toMatchObject({ theme: "light", caption: { source: "microphone" }, layout: DEFAULT_USER_SETTINGS.layout });
  });
});

describe("parseUserSettings", () => {
  it("restores independent layout preferences without losing version 4 translation consent", () => {
    expect(parseUserSettings({ version: 4, theme: "dark", selectionTranslation: false,
      caption: { showChinese: true, source: "microphone" },
      layout: { leftWidth: 320, rightWidth: 280, leftOpen: false, rightOpen: true },
      keybindings: { "file.save": "Mod+Alt+S" },
    })).toMatchObject({ theme: "dark", selectionTranslation: false,
      caption: { showChinese: true, source: "microphone" },
      layout: { leftWidth: 320, rightWidth: 280, leftOpen: false, rightOpen: true },
      keybindings: { "file.save": "Mod+Alt+S" },
    });
  });
  it("accepts known commands and removes unknown entries", () => {
    expect(parseUserSettings({
      version: USER_SETTINGS_VERSION,
      keybindings: {
        "file.save": "  Mod+S  ",
        "not.a.command": "Mod+X",
        "view.zoomIn": null
      }
    })).toEqual({
      caption: DEFAULT_USER_SETTINGS.caption,
      layout: DEFAULT_USER_SETTINGS.layout,
      selectionTranslation: true,
      version: USER_SETTINGS_VERSION,
      language: "system",
      theme: "system",
      keybindings: {
        "file.save": "Mod+S",
        "view.zoomIn": null
      }
    });
  });

  it("validates language and theme preferences", () => {
    expect(parseUserSettings({
      version: USER_SETTINGS_VERSION,
      language: "zh-CN",
      theme: "dark",
      keybindings: {},
    })).toEqual({
      caption: DEFAULT_USER_SETTINGS.caption,
      layout: DEFAULT_USER_SETTINGS.layout,
      selectionTranslation: true,
      version: USER_SETTINGS_VERSION,
      language: "zh-CN",
      theme: "dark",
      keybindings: {},
    });
  });

  it("migrates version 1 keybindings into the current settings shape", () => {
    expect(parseUserSettings({
      version: 1,
      keybindings: { "file.save": "Mod+S" },
    })).toEqual({
      caption: DEFAULT_USER_SETTINGS.caption,
      layout: DEFAULT_USER_SETTINGS.layout,
      selectionTranslation: true,
      version: USER_SETTINGS_VERSION,
      language: "system",
      theme: "system",
      keybindings: { "file.save": "Mod+S" },
    });
  });

  it("falls back when the settings version is unsupported", () => {
    expect(parseUserSettings({ version: 99, keybindings: {} })).toBe(
      DEFAULT_USER_SETTINGS,
    );
  });
  it("defaults selection translation on and preserves an explicit opt-out", () => {
    expect(parseUserSettings({ version: 2 }).selectionTranslation).toBe(true);
    expect(parseUserSettings({ version: 2, selectionTranslation: false }).selectionTranslation).toBe(false);
    expect(parseUserSettings({ version: 2, selectionTranslation: "false" }).selectionTranslation).toBe(true);
  });
  it("migrates caption preferences without persisting recording state", () => {
    expect(parseUserSettings({ version: 2 }).caption).toEqual(DEFAULT_USER_SETTINGS.caption);
    const settings = parseUserSettings({ version: 3, caption: { source: "microphone", language: "chinese", timestamps: true, active: true } });
    expect(settings.caption).toEqual({ source: "microphone", language: "chinese", timestamps: true, showChinese: false, pinned: true });
    expect(parseUserSettings({ version: 3, caption: { source: "remote", language: "invalid" } }).caption).toEqual(DEFAULT_USER_SETTINGS.caption);
  });
});
