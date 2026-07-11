import { describe, expect, it } from "vitest";
import {
  codeMirrorKeyForCommand,
  effectiveAcceleratorForCommand,
  parseKeybinding,
  resolveShortcutDefinitions,
} from "./keybindingResolver";

describe("parseKeybinding", () => {
  it("normalizes cross-platform modifier aliases", () => {
    expect(parseKeybinding("file.save", "Command+Shift+S")).toEqual({
      command: "file.save",
      key: "s",
      altKey: false,
      shiftKey: true
    });
    expect(parseKeybinding("file.save", "Ctrl+S")?.key).toBe("s");
  });

  it("rejects bindings without a primary modifier or with an invalid key", () => {
    expect(parseKeybinding("file.save", "Shift+S")).toBeNull();
    expect(parseKeybinding("file.save", "Mod+Save")).toBeNull();
  });
});

describe("resolveShortcutDefinitions", () => {
  it("applies valid overrides and allows a command to be disabled", () => {
    const shortcuts = resolveShortcutDefinitions({
      "file.openFile": null,
      "file.save": "Mod+Alt+S"
    });

    expect(shortcuts.find(({ command }) => command === "file.openFile")).toBeUndefined();
    expect(shortcuts.find(({ command }) => command === "file.save")).toMatchObject({
      altKey: true,
      command: "file.save",
      key: "s"
    });
  });
});

describe("codeMirrorKeyForCommand", () => {
  it("uses the same override syntax for editor keymaps", () => {
    expect(codeMirrorKeyForCommand("format.bold", "Mod-b", {
      "format.bold": "Mod+Alt+B",
    })).toBe("Mod-Alt-b");
    expect(codeMirrorKeyForCommand("format.bold", "Mod-b", {
      "format.bold": null,
    })).toBeNull();
  });
});

describe("effectiveAcceleratorForCommand", () => {
  it("keeps native menu accelerators aligned with user overrides", () => {
    expect(effectiveAcceleratorForCommand("file.save", {
      "file.save": "Mod+Shift+Alt+S",
    })).toBe("Shift+CmdOrCtrl+Alt+S");
    expect(effectiveAcceleratorForCommand("file.save", {
      "file.save": null,
    })).toBeUndefined();
  });
});
