import type { AppCommand } from "../shared/commands/appCommandTypes";
import { hasPrimaryModifier } from "../shared/platform/keyboard";
import type { KeybindingOverrides } from "../shared/settings/userSettings";
import {
  acceleratorForCommand,
  type CommandShortcutContext,
  shortcutDefinitions,
  type ShortcutDefinition,
} from "./appCommandRegistry";

const MODIFIER_ALIASES = new Map([
  ["alt", "alt"],
  ["cmd", "mod"],
  ["cmdorctrl", "mod"],
  ["command", "mod"],
  ["control", "mod"],
  ["ctrl", "mod"],
  ["meta", "mod"],
  ["mod", "mod"],
  ["primary", "mod"],
  ["option", "alt"],
  ["shift", "shift"]
]);

export type KeybindingContext = {
  editorFocused: boolean;
  fileTreeFocused: boolean;
  tableCellFocused: boolean;
  textInputFocused: boolean;
};

export type KeybindingConflict = {
  commands: AppCommand[];
  key: string;
  context: CommandShortcutContext;
};

export type ResolvedShortcut =
  | { kind: "match"; shortcut: ShortcutDefinition }
  | { kind: "conflict"; shortcuts: ShortcutDefinition[] }
  | { kind: "none" };

export function resolveShortcutDefinitions(
  overrides: KeybindingOverrides,
): ShortcutDefinition[] {
  const shortcutsByCommand = new Map<AppCommand, ShortcutDefinition[]>();
  for (const shortcut of shortcutDefinitions()) {
    shortcutsByCommand.set(shortcut.command, [
      ...(shortcutsByCommand.get(shortcut.command) ?? []),
      shortcut,
    ]);
  }

  for (const [command, binding] of Object.entries(overrides) as Array<
    [AppCommand, string | null]
  >) {
    if (binding === null) {
      shortcutsByCommand.delete(command);
      continue;
    }

    const parsed = parseKeybinding(command, binding);
    if (parsed) {
      const currentShortcuts = shortcutsByCommand.get(command) ?? [];
      const replacementIndex = currentShortcuts.findIndex(
        (shortcut) => shortcut.primaryModifier !== false,
      );
      const defaultShortcut = currentShortcuts[replacementIndex] ?? currentShortcuts[0];
      const replacement = {
        ...parsed,
        ...(defaultShortcut?.editorHandled ? { editorHandled: true } : {}),
        ...(defaultShortcut?.priority !== undefined
          ? { priority: defaultShortcut.priority }
          : {}),
        ...(defaultShortcut?.when ? { when: defaultShortcut.when } : {}),
      };

      if (currentShortcuts.length === 0) {
        shortcutsByCommand.set(command, [replacement]);
      } else {
        const targetIndex = replacementIndex >= 0 ? replacementIndex : 0;
        shortcutsByCommand.set(
          command,
          currentShortcuts.map((shortcut, index) =>
            index === targetIndex ? replacement : shortcut,
          ),
        );
      }
    }
  }

  return Array.from(shortcutsByCommand.values()).flat();
}

export function effectiveAcceleratorForCommand(
  command: AppCommand,
  overrides: KeybindingOverrides,
): string | undefined {
  const defaultAccelerator = acceleratorForCommand(command);
  if (!defaultAccelerator) {
    return undefined;
  }

  const override = overrides[command];
  if (override === null) {
    return undefined;
  }
  if (override === undefined) {
    return defaultAccelerator;
  }

  const parsed = parseKeybinding(command, override);
  if (!parsed) {
    return defaultAccelerator;
  }

  return [
    parsed.shiftKey ? "Shift" : "",
    parsed.primaryModifier !== false ? "CmdOrCtrl" : "",
    parsed.altKey ? "Alt" : "",
    displayShortcutKey(parsed.key),
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
  const key = normalizeShortcutKey(parts.at(-1));
  if (!key) {
    return null;
  }

  const modifiers = new Set(
    parts.slice(0, -1).map((part) => MODIFIER_ALIASES.get(part)),
  );
  if (modifiers.has(undefined)) {
    return null;
  }

  const primaryModifier = modifiers.has("mod");
  if (!primaryModifier && !isNonPrimaryShortcutKey(key)) {
    return null;
  }

  return {
    command,
    key,
    altKey: modifiers.has("alt"),
    ...(primaryModifier ? {} : { primaryModifier: false }),
    shiftKey: modifiers.has("shift"),
  };
}

export function codeMirrorKeysForCommand(
  command: AppCommand,
  overrides: KeybindingOverrides,
): string[] {
  return Array.from(new Set(
    resolveShortcutDefinitions(overrides)
      .filter((shortcut) => shortcut.command === command)
      .map((shortcut) => [
        shortcut.primaryModifier !== false ? "Mod" : "",
        shortcut.shiftKey ? "Shift" : "",
        shortcut.altKey ? "Alt" : "",
        shortcut.key,
      ].filter(Boolean).join("-")),
  ));
}

export function resolveShortcutForKeyboardEvent(
  event: KeyboardEvent,
  shortcuts: ShortcutDefinition[],
  context: KeybindingContext,
): ResolvedShortcut {
  // IME composition uses intermediate keyboard events that must remain owned
  // by the text input. Some WebViews expose these as the Process key.
  if (event.isComposing || event.key === "Process") {
    return { kind: "none" };
  }

  const key = event.key.toLowerCase();
  const codeKey = keyFromKeyboardCode(event.code);
  const matching = shortcuts.filter((shortcut) => {
    if ((shortcut.primaryModifier !== false) !== hasPrimaryModifier(event)) {
      return false;
    }
    if (!matchesShortcutContext(shortcut.when, context)) {
      return false;
    }

    if (shortcut.command === "view.zoomIn" && (key === "+" || key === "=")) {
      return !event.altKey;
    }

    return (
      (shortcut.key === key || shortcut.key === codeKey) &&
      Boolean(shortcut.altKey) === event.altKey &&
      Boolean(shortcut.shiftKey) === event.shiftKey
    );
  });

  if (matching.length === 0) {
    return { kind: "none" };
  }

  const highestPriority = Math.max(
    ...matching.map((shortcut) => shortcut.priority ?? 0),
  );
  const winners = matching.filter(
    (shortcut) => (shortcut.priority ?? 0) === highestPriority,
  );

  return winners.length === 1
    ? { kind: "match", shortcut: winners[0] }
    : { kind: "conflict", shortcuts: winners };
}

/**
 * Lets an embedded editor keep its own document transaction while resolving
 * the trigger from the same configurable command bindings as the app shell.
 */
export function matchesCommandShortcut(
  event: KeyboardEvent,
  command: AppCommand,
  overrides: KeybindingOverrides,
  context: KeybindingContext,
): boolean {
  const resolved = resolveShortcutForKeyboardEvent(
    event,
    resolveShortcutDefinitions(overrides),
    context,
  );
  return resolved.kind === "match" && resolved.shortcut.command === command;
}

export function contextFromKeyboardEventTarget(
  target: EventTarget | null,
): KeybindingContext {
  const element = target instanceof Element ? target : null;
  const editorFocused = Boolean(element?.closest(".cm-editor"));
  const fileTreeFocused = Boolean(element?.closest("[data-file-tree]"));
  const tableCellFocused = Boolean(element?.closest("[data-table-focus-index]"));
  const textInputFocused = Boolean(
    element?.closest("input, textarea, select, [contenteditable=\"true\"]"),
  );

  return {
    editorFocused,
    fileTreeFocused,
    tableCellFocused,
    textInputFocused,
  };
}

export function findKeybindingConflicts(
  shortcuts: ShortcutDefinition[],
): KeybindingConflict[] {
  const conflicts: KeybindingConflict[] = [];
  const contexts = [
    { name: "always" as const, context: emptyKeybindingContext() },
    {
      name: "editorFocus" as const,
      context: { ...emptyKeybindingContext(), editorFocused: true },
    },
    {
      name: "tableCellFocus" as const,
      context: {
        ...emptyKeybindingContext(),
        editorFocused: true,
        tableCellFocused: true,
        textInputFocused: true,
      },
    },
    {
      name: "fileTreeFocus" as const,
      context: { ...emptyKeybindingContext(), fileTreeFocused: true },
    },
  ];

  for (const { name, context } of contexts) {
    const groups = new Map<string, ShortcutDefinition[]>();
    for (const shortcut of shortcuts) {
      if (!matchesShortcutContext(shortcut.when, context)) {
        continue;
      }
      const key = shortcutSignature(shortcut);
      groups.set(key, [...(groups.get(key) ?? []), shortcut]);
    }

    for (const [key, matching] of groups) {
      const highestPriority = Math.max(
        ...matching.map((shortcut) => shortcut.priority ?? 0),
      );
      const winners = matching.filter(
        (shortcut) => (shortcut.priority ?? 0) === highestPriority,
      );
      if (winners.length > 1) {
        conflicts.push({
          commands: winners.map((shortcut) => shortcut.command),
          context: name,
          key,
        });
      }
    }
  }

  return conflicts;
}

function matchesShortcutContext(
  when: CommandShortcutContext | undefined,
  context: KeybindingContext,
): boolean {
  if (!when || when === "always") {
    return true;
  }
  if (when === "editorFocus") {
    return context.editorFocused;
  }
  if (when === "fileTreeFocus") {
    return context.fileTreeFocused && !context.textInputFocused;
  }
  return context.tableCellFocused;
}

function shortcutSignature(shortcut: ShortcutDefinition): string {
  return [
    shortcut.primaryModifier !== false ? "Mod" : "",
    shortcut.shiftKey ? "Shift" : "",
    shortcut.altKey ? "Alt" : "",
    shortcut.key,
  ].filter(Boolean).join("+");
}

function emptyKeybindingContext(): KeybindingContext {
  return {
    editorFocused: false,
    fileTreeFocused: false,
    tableCellFocused: false,
    textInputFocused: false,
  };
}

function keyFromKeyboardCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toLowerCase();
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  return "";
}

function normalizeShortcutKey(key: string | undefined): string | null {
  if (!key) {
    return null;
  }

  const normalized = key.toLowerCase();
  return normalized.length === 1 || isNonPrimaryShortcutKey(normalized)
    ? normalized
    : null;
}

function isNonPrimaryShortcutKey(key: string): boolean {
  return /^f(?:[1-9]|1[0-2])$/.test(key) || [
    "arrowdown",
    "arrowleft",
    "arrowright",
    "arrowup",
    "backspace",
    "delete",
    "end",
    "enter",
    "escape",
    "home",
    "tab",
  ].includes(key);
}

function displayShortcutKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
}
