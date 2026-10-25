import { afterEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  DEFAULT_USER_SETTINGS,
  parseUserSettings,
  USER_SETTINGS_VERSION,
  readUserSettings,
  updateUserSettings,
} from "./userSettings";

afterEach(() => vi.unstubAllGlobals());

describe("settings persistence", () => {
  function mockWindow() {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, dispatchEvent: vi.fn() });
    return values;
  }
  it("does not overwrite explicit system preferences with legacy values on restart", () => {
    const values = mockWindow();
    values.set(STORAGE_KEYS.legacyLanguage, "zh-CN"); values.set(STORAGE_KEYS.legacyTheme, "dark");
    expect(readUserSettings().theme).toBe("dark");
    updateUserSettings({ theme: "system", language: "system", selectionTranslation: false });
    expect(readUserSettings()).toMatchObject({ theme: "system", language: "system", selectionTranslation: false });
  });
  it("preserves caption preferences and keybindings when updating another setting", () => {
    mockWindow();
    updateUserSettings({ caption: { ...DEFAULT_USER_SETTINGS.caption, source: "microphone" }, keybindings: { "caption.start": "Mod+Alt+L" } });
    updateUserSettings({ selectionTranslation: false });
    expect(readUserSettings()).toMatchObject({ caption: { source: "microphone" }, keybindings: { "caption.start": "Mod+Alt+L" }, selectionTranslation: false });
  });
  it("defaults caption translation off and persists a new explicit opt-in", () => {
    const values = mockWindow();
    expect(readUserSettings().caption).toMatchObject({ showChinese: false, language: "english" });
    values.set(STORAGE_KEYS.settings, JSON.stringify({ version: 3, theme: "dark", caption: { showChinese: true, source: "microphone" } }));
    expect(readUserSettings()).toMatchObject({ theme: "dark", caption: { source: "microphone", showChinese: false } });
    updateUserSettings({ caption: { ...readUserSettings().caption, showChinese: true } });
    updateUserSettings({ theme: "light" });
    expect(readUserSettings().caption.showChinese).toBe(true);
    updateUserSettings({ caption: { ...readUserSettings().caption, showChinese: false } });
    expect(readUserSettings().caption.showChinese).toBe(false);
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
