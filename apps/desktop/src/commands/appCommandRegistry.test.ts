import { describe, expect, it } from "vitest";
import { localeMessages } from "../shared/i18n/translate";
import {
  appCommandRegistry,
  type ShortcutDefinition,
} from "./appCommandRegistry";

describe("appCommandRegistry", () => {
  it("maps every command to an English user-facing title", () => {
    const english = localeMessages("en");

    Object.entries(appCommandRegistry).forEach(([command, definition]) => {
      expect(
        english[definition.titleKey],
        `Missing English title for ${command}: ${definition.titleKey}`,
      ).toEqual(expect.any(String));
    });
  });

  it("keeps shortcut definitions attached to the command they execute", () => {
    Object.entries(appCommandRegistry).forEach(([command, definition]) => {
      [definition.shortcut, ...(definition.shortcuts ?? [])]
        .filter((shortcut): shortcut is ShortcutDefinition => shortcut !== undefined)
        .forEach((shortcut) => {
          expect(shortcut.command).toBe(command);
        });
    });
  });
});
