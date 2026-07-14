import { describe, expect, it } from "vitest";
import { createEditorCommandBindings } from "./editorCommandKeymap";

describe("createEditorCommandBindings", () => {
  it("derives CodeMirror bindings from the command registry", () => {
    const bindings = createEditorCommandBindings({
      keybindingOverrides: {},
      runMarkdownFormatCommand: () => true,
    });

    expect(bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "Mod-b", preventDefault: true }),
      expect.objectContaining({ key: "Mod-Shift-z", preventDefault: true }),
      expect.objectContaining({ key: "Mod-y", preventDefault: true }),
    ]));
  });

  it("honors disabled and overridden user bindings without creating local shortcuts", () => {
    const bindings = createEditorCommandBindings({
      keybindingOverrides: {
        "edit.undo": null,
        "format.bold": "Mod+Alt+B",
      },
      runMarkdownFormatCommand: () => true,
    });
    const keys = bindings.map(({ key }) => key);

    expect(keys).toContain("Mod-Alt-b");
    expect(keys).not.toContain("Mod-b");
    expect(keys).not.toContain("Mod-z");
  });
});
