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
});
