import { describe, expect, it } from "vitest";
import {
  codeMirrorKeysForCommand,
  effectiveAcceleratorForCommand,
  findKeybindingConflicts,
  matchesCommandShortcut,
  parseKeybinding,
  resolveShortcutDefinitions,
  resolveShortcutForKeyboardEvent,
  type KeybindingContext,
} from "./keybindingResolver";
import { isApplePlatform } from "../shared/platform/keyboard";

const editorContext: KeybindingContext = {
  editorFocused: true,
  fileTreeFocused: false,
  tableCellFocused: false,
  textInputFocused: true,
};

const fileTreeContext: KeybindingContext = {
  editorFocused: false,
  fileTreeFocused: true,
  tableCellFocused: false,
  textInputFocused: false,
};

function keydownEvent(
  values: Pick<KeyboardEvent, "code" | "key"> & Partial<
    Pick<KeyboardEvent, "altKey" | "ctrlKey" | "isComposing" | "metaKey" | "shiftKey">
  >,
): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    metaKey: false,
    shiftKey: false,
    ...values,
  } as KeyboardEvent;
}

function primaryModifierEvent(
  values: Pick<KeyboardEvent, "code" | "key"> & Partial<
    Pick<KeyboardEvent, "altKey" | "isComposing" | "shiftKey">
  >,
): KeyboardEvent {
  return keydownEvent({
    ...values,
    ...(isApplePlatform() ? { metaKey: true } : { ctrlKey: true }),
  });
}

describe("parseKeybinding", () => {
  it("normalizes cross-platform modifier aliases", () => {
    expect(parseKeybinding("file.save", "Command+Shift+S")).toEqual({
      command: "file.save",
      key: "s",
      altKey: false,
      shiftKey: true
    });
    expect(parseKeybinding("file.save", "Ctrl+S")?.key).toBe("s");
    expect(parseKeybinding("file.save", "CmdOrCtrl+S")?.key).toBe("s");
    expect(parseKeybinding("file.save", "Primary+S")?.key).toBe("s");
  });

  it("rejects bindings without a primary modifier or with an invalid key", () => {
    expect(parseKeybinding("file.save", "Shift+S")).toBeNull();
    expect(parseKeybinding("file.save", "Mod+Save")).toBeNull();
  });

  it("allows non-printable bindings without a primary modifier", () => {
    expect(parseKeybinding("file.rename", "F2")).toEqual({
      command: "file.rename",
      key: "f2",
      altKey: false,
      primaryModifier: false,
      shiftKey: false,
    });
  });
});

describe("resolveShortcutDefinitions", () => {
  it("exposes CodeMirror history commands to menu accelerators and conflict checks", () => {
    const shortcuts = resolveShortcutDefinitions({});

    expect(shortcuts.find(({ command }) => command === "edit.undo")).toMatchObject({
      command: "edit.undo",
      editorHandled: true,
      key: "z",
      priority: 100,
      when: "editorFocus",
    });
    expect(shortcuts.find(({ command }) => command === "edit.redo")).toMatchObject({
      command: "edit.redo",
      editorHandled: true,
      key: "z",
      shiftKey: true,
      when: "editorFocus",
    });
  });

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

  it("keeps secondary contextual shortcuts when overriding a command", () => {
    const shortcuts = resolveShortcutDefinitions({
      "file.rename": "F3",
    });

    expect(shortcuts.filter(({ command }) => command === "file.rename")).toEqual([
      {
        command: "file.rename",
        key: "f3",
        altKey: false,
        primaryModifier: false,
        shiftKey: false,
        when: "fileTreeFocus",
      },
      {
        command: "file.rename",
        key: "enter",
        primaryModifier: false,
        when: "fileTreeFocus",
      },
    ]);
  });
});

describe("codeMirrorKeysForCommand", () => {
  it("uses command definitions and overrides for editor keymaps", () => {
    expect(codeMirrorKeysForCommand("format.bold", {
      "format.bold": "Mod+Alt+B",
    })).toEqual(["Mod-Alt-b"]);
    expect(codeMirrorKeysForCommand("format.bold", {
      "format.bold": null,
    })).toEqual([]);
  });

  it("keeps configured secondary bindings for commands that support them", () => {
    expect(codeMirrorKeysForCommand("edit.redo", {}))
      .toEqual(["Mod-Shift-z", "Mod-y"]);
  });

  it("exposes editor keymaps even when a command is not globally editor-handled", () => {
    expect(codeMirrorKeysForCommand("format.heading1", {})).toEqual(["Mod-1"]);
  });
});

describe("effectiveAcceleratorForCommand", () => {
  it("derives the native menu accelerator from the same default shortcut", () => {
    expect(effectiveAcceleratorForCommand("file.save", {})).toBe("CmdOrCtrl+S");
    expect(effectiveAcceleratorForCommand("view.resetZoom", {})).toBe("CmdOrCtrl+0");
  });

  it("keeps native menu accelerators aligned with user overrides", () => {
    expect(effectiveAcceleratorForCommand("file.save", {
      "file.save": "Mod+Shift+Alt+S",
    })).toBe("Shift+CmdOrCtrl+Alt+S");
    expect(effectiveAcceleratorForCommand("file.save", {
      "file.save": null,
    })).toBeUndefined();
    expect(effectiveAcceleratorForCommand("file.rename", {
      "file.rename": "F3",
    })).toBeUndefined();
  });
});

describe("resolveShortcutForKeyboardEvent", () => {
  it("prefers an editor-specific binding over an always-active binding", () => {
    const result = resolveShortcutForKeyboardEvent(
      primaryModifierEvent({ code: "KeyB", key: "b" }),
      [
        { command: "file.save", key: "b" },
        {
          command: "format.bold",
          key: "b",
          priority: 100,
          when: "editorFocus",
        },
      ],
      editorContext,
    );

    expect(result).toEqual({
      kind: "match",
      shortcut: {
        command: "format.bold",
        key: "b",
        priority: 100,
        when: "editorFocus",
      },
    });
  });

  it("does not choose an arbitrary command when equal-priority bindings collide", () => {
    const result = resolveShortcutForKeyboardEvent(
      primaryModifierEvent({ code: "KeyS", key: "s" }),
      [
        { command: "file.save", key: "s" },
        { command: "repository.syncNow", key: "s" },
      ],
      editorContext,
    );

    expect(result.kind).toBe("conflict");
  });

  it("resolves File Tree-only non-primary bindings without hijacking text inputs", () => {
    const shortcuts = [{
      command: "file.rename" as const,
      key: "f2",
      primaryModifier: false,
      when: "fileTreeFocus" as const,
    }];
    const event = keydownEvent({ code: "F2", ctrlKey: false, key: "F2" });

    expect(resolveShortcutForKeyboardEvent(event, shortcuts, fileTreeContext)).toEqual({
      kind: "match",
      shortcut: shortcuts[0],
    });
    expect(resolveShortcutForKeyboardEvent(event, shortcuts, {
      ...fileTreeContext,
      textInputFocused: true,
    })).toEqual({ kind: "none" });
  });

  it("does not resolve application commands during IME composition", () => {
    const shortcuts = [{ command: "file.save" as const, key: "s" }];

    expect(resolveShortcutForKeyboardEvent(
      primaryModifierEvent({ code: "KeyS", isComposing: true, key: "s" }),
      shortcuts,
      editorContext,
    )).toEqual({ kind: "none" });
    expect(resolveShortcutForKeyboardEvent(
      primaryModifierEvent({ code: "Process", key: "Process" }),
      shortcuts,
      editorContext,
    )).toEqual({ kind: "none" });
  });
});

describe("matchesCommandShortcut", () => {
  it("honors a configured embedded-editor command binding", () => {
    const event = primaryModifierEvent({
      code: "KeyB",
      key: "b",
      shiftKey: true,
    });

    expect(matchesCommandShortcut(
      event,
      "format.bold",
      { "format.bold": "CmdOrCtrl+Shift+B" },
      {
        editorFocused: true,
        fileTreeFocused: false,
        tableCellFocused: true,
        textInputFocused: true,
      },
    )).toBe(true);
  });
});

describe("findKeybindingConflicts", () => {
  it("keeps the built-in keymap conflict-free in every supported command context", () => {
    expect(findKeybindingConflicts(resolveShortcutDefinitions({}))).toEqual([]);
  });

  it("reports only conflicts that can occur in the same command context", () => {
    expect(findKeybindingConflicts([
      { command: "file.save", key: "s" },
      { command: "repository.syncNow", key: "s" },
      { command: "format.bold", key: "b", priority: 100, when: "editorFocus" },
    ])).toEqual([
      {
        commands: ["file.save", "repository.syncNow"],
        context: "always",
        key: "Mod+s",
      },
      {
        commands: ["file.save", "repository.syncNow"],
        context: "editorFocus",
        key: "Mod+s",
      },
      {
        commands: ["file.save", "repository.syncNow"],
        context: "tableCellFocus",
        key: "Mod+s",
      },
      {
        commands: ["file.save", "repository.syncNow"],
        context: "fileTreeFocus",
        key: "Mod+s",
      },
    ]);
  });
});
