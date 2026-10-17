import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_SETTINGS,
  parseUserSettings,
  USER_SETTINGS_VERSION,
} from "./userSettings";

describe("parseUserSettings", () => {
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
    expect(settings.caption).toEqual({ source: "microphone", language: "chinese", timestamps: true, showChinese: true, pinned: true });
    expect(parseUserSettings({ version: 3, caption: { source: "remote", language: "invalid" } }).caption).toEqual(DEFAULT_USER_SETTINGS.caption);
  });
});
