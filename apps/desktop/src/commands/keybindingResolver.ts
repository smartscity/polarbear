import type { AppCommand } from "../shared/commands/appCommandTypes";
import type { KeybindingOverrides } from "../shared/settings/userSettings";
import {
  acceleratorForCommand,
  shortcutDefinitions,
  type ShortcutDefinition,
} from "./appCommandRegistry";

const MODIFIER_ALIASES = new Map([
  ["alt", "alt"],
  ["cmd", "mod"],
  ["command", "mod"],
  ["control", "mod"],
  ["ctrl", "mod"],
  ["meta", "mod"],
  ["mod", "mod"],
  ["option", "alt"],
  ["shift", "shift"]
]);

export function resolveShortcutDefinitions(
  overrides: KeybindingOverrides,
): ShortcutDefinition[] {
  const shortcutsByCommand = new Map<AppCommand, ShortcutDefinition>(
    shortcutDefinitions().map((shortcut) => [shortcut.command, shortcut]),
  );

  for (const [command, binding] of Object.entries(overrides) as Array<
    [AppCommand, string | null]
  >) {
    if (binding === null) {
      shortcutsByCommand.delete(command);
      continue;
    }

    const parsed = parseKeybinding(command, binding);
    if (parsed) {
      const defaultShortcut = shortcutsByCommand.get(command);
      shortcutsByCommand.set(command, {
        ...parsed,
        editorHandled: defaultShortcut?.editorHandled
      });
    }
  }

  return Array.from(shortcutsByCommand.values());
}

export function effectiveAcceleratorForCommand(
  command: AppCommand,
  overrides: KeybindingOverrides,
): string | undefined {
  const override = overrides[command];
  if (override === null) {
    return undefined;
  }
  if (override === undefined) {
    return acceleratorForCommand(command);
  }

  const parsed = parseKeybinding(command, override);
  if (!parsed) {
    return acceleratorForCommand(command);
  }

  return [
    parsed.shiftKey ? "Shift" : "",
    "CmdOrCtrl",
    parsed.altKey ? "Alt" : "",
    parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key,
  ].filter(Boolean).join("+");
}

export function parseKeybinding(
  command: AppCommand,
  binding: string,
): ShortcutDefinition | null {
  const parts = binding
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const key = parts.at(-1);
  if (!key || key.length > 1 || !parts.slice(0, -1).some(isPrimaryModifier)) {
    return null;
  }

  const modifiers = new Set(
    parts.slice(0, -1).map((part) => MODIFIER_ALIASES.get(part)),
  );
  if (modifiers.has(undefined)) {
    return null;
  }

  return {
    command,
    key,
    altKey: modifiers.has("alt"),
    shiftKey: modifiers.has("shift")
  };
}

export function codeMirrorKeyForCommand(
  command: AppCommand,
  fallback: string,
  overrides: KeybindingOverrides,
): string | null {
  const override = overrides[command];
  if (override === null) {
    return null;
  }
  if (override === undefined) {
    return fallback;
  }

  const parsed = parseKeybinding(command, override);
  if (!parsed) {
    return fallback;
  }

  return [
    "Mod",
    parsed.shiftKey ? "Shift" : "",
    parsed.altKey ? "Alt" : "",
    parsed.key,
  ].filter(Boolean).join("-");
}

function isPrimaryModifier(part: string): boolean {
  return MODIFIER_ALIASES.get(part) === "mod";
}
