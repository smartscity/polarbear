import { isAppCommandId } from "../commands/appCommandIds";
import type { AppCommand } from "../commands/appCommandTypes";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { APP_EVENTS } from "../events/appEvents";

export const USER_SETTINGS_VERSION = 2;

export type KeybindingOverrides = Partial<Record<AppCommand, string | null>>;
export type LanguagePreference = string;
export type ThemePreference = "system" | "light" | "dark";

export type UserSettings = {
  version: typeof USER_SETTINGS_VERSION;
  language: LanguagePreference;
  theme: ThemePreference;
  keybindings: KeybindingOverrides;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  version: USER_SETTINGS_VERSION,
  language: "system",
  theme: "system",
  keybindings: {}
};

export function readUserSettings(): UserSettings {
  try {
    const serialized = window.localStorage.getItem(STORAGE_KEYS.settings)
      ?? window.localStorage.getItem(STORAGE_KEYS.legacySettings);
    if (!serialized) {
      return settingsFromLegacyPreferences(DEFAULT_USER_SETTINGS);
    }
    return settingsFromLegacyPreferences(parseUserSettings(JSON.parse(serialized)));
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

export function writeUserSettings(settings: UserSettings): void {
  const validatedSettings = parseUserSettings(settings);
  window.localStorage.setItem(
    STORAGE_KEYS.settings,
    JSON.stringify(validatedSettings),
  );
  window.dispatchEvent(new CustomEvent(APP_EVENTS.settingsChanged));
}

export function updateUserSettings(
  update: Partial<Pick<UserSettings, "keybindings" | "language" | "theme">>,
): UserSettings {
  const nextSettings = parseUserSettings({
    ...readUserSettings(),
    ...update,
    version: USER_SETTINGS_VERSION,
  });
  writeUserSettings(nextSettings);
  return nextSettings;
}

export function parseUserSettings(value: unknown): UserSettings {
  if (!isRecord(value) || (value.version !== 1 && value.version !== USER_SETTINGS_VERSION)) {
    return DEFAULT_USER_SETTINGS;
  }

  const keybindings: KeybindingOverrides = {};
  if (isRecord(value.keybindings)) {
    for (const [command, binding] of Object.entries(value.keybindings)) {
      if (
        isAppCommandId(command) &&
        (binding === null || (typeof binding === "string" && binding.trim().length > 0))
      ) {
        keybindings[command] = binding === null ? null : binding.trim();
      }
    }
  }

  return {
    version: USER_SETTINGS_VERSION,
    language: isLanguagePreference(value.language) ? value.language : "system",
    theme: isThemePreference(value.theme) ? value.theme : "system",
    keybindings
  };
}

function settingsFromLegacyPreferences(settings: UserSettings): UserSettings {
  const language = settings.language === "system"
    ? window.localStorage.getItem(STORAGE_KEYS.legacyLanguage)
    : settings.language;
  const theme = settings.theme === "system"
    ? window.localStorage.getItem(STORAGE_KEYS.legacyTheme)
    : settings.theme;

  return {
    ...settings,
    language: isLanguagePreference(language) ? language : settings.language,
    theme: isThemePreference(theme) ? theme : settings.theme,
  };
}

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return typeof value === "string" && (
    value === "system" || /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value)
  );
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
