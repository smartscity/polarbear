import { isAppCommandId } from "../commands/appCommandIds";
import type { AppCommand } from "../commands/appCommandTypes";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { cachedSettings, commitSettings, initializeSettings } from "./settingsDatabase";
import { DEFAULT_LAYOUT, parseLayoutPreferences, type LayoutPreferences } from "./layoutPreferences";

export const USER_SETTINGS_VERSION = 5;

export type CaptionPreferences = {
  source: "system" | "microphone";
  language: "bilingual" | "english" | "chinese";
  timestamps: boolean;
  showChinese: boolean;
  pinned: boolean;
};
const DEFAULT_CAPTION: CaptionPreferences = { source: "system", language: "english", timestamps: false, showChinese: false, pinned: true };

export type KeybindingOverrides = Partial<Record<AppCommand, string | null>>;
export type LanguagePreference = string;
export type ThemePreference = "system" | "light" | "dark";

export type UserSettings = {
  version: typeof USER_SETTINGS_VERSION;
  language: LanguagePreference;
  theme: ThemePreference;
  selectionTranslation: boolean;
  caption: CaptionPreferences;
  keybindings: KeybindingOverrides;
  layout: LayoutPreferences;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  version: USER_SETTINGS_VERSION,
  language: "system",
  theme: "system",
  selectionTranslation: true,
  caption: DEFAULT_CAPTION,
  layout: DEFAULT_LAYOUT,
  keybindings: {}
};

export function readUserSettings(): UserSettings {
  try {
    const cached = cachedSettings();
    return cached === undefined ? readStoredSettings() : parseUserSettings(cached);
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

function readStoredSettings(): UserSettings {
  const current = window.localStorage.getItem(STORAGE_KEYS.settings);
  if (current !== null) return parseUserSettings(JSON.parse(current));
  const serialized = window.localStorage.getItem(STORAGE_KEYS.legacySettings);
  if (!serialized) {
    return settingsFromLegacyPreferences(DEFAULT_USER_SETTINGS);
  }
  return settingsFromLegacyPreferences(parseUserSettings(JSON.parse(serialized)));
}

export function initializeUserSettings(): Promise<void> {
  return initializeSettings(readStoredSettings);
}

export type UserSettingsPatch = Partial<Pick<UserSettings, "language" | "theme" | "selectionTranslation">> & {
  caption?: Partial<CaptionPreferences>;
  layout?: Partial<LayoutPreferences>;
  // null disables a binding; undefined removes the override and restores its default.
  keybindings?: KeybindingOverrides;
};

const SETTINGS_LOCK_TIMEOUT_MS = 5_000;

export async function updateUserSettings(update: UserSettingsPatch): Promise<UserSettings> {
  const patch = structuredClone(update);
  if (!navigator.locks) throw new Error("Cross-window settings locking is unavailable.");
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), SETTINGS_LOCK_TIMEOUT_MS);
  try {
    // Bound admission separately from the IndexedDB transaction that owns merging.
    return await navigator.locks.request(STORAGE_KEYS.settings, { mode: "exclusive", signal: abort.signal }, async () => {
      const committed = await commitSettings(readStoredSettings, value => {
        const current = parseUserSettings(value);
        return parseUserSettings({
          ...current, ...patch,
          caption: { ...current.caption, ...patch.caption },
          layout: { ...current.layout, ...patch.layout },
          keybindings: { ...current.keybindings, ...patch.keybindings },
          version: USER_SETTINGS_VERSION,
        });
      });
      return parseUserSettings(committed);
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function parseUserSettings(value: unknown): UserSettings {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== USER_SETTINGS_VERSION)) {
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
    selectionTranslation: typeof value.selectionTranslation === "boolean" ? value.selectionTranslation : true,
    caption: parseCaption(value.caption, value.version === 4 || value.version === USER_SETTINGS_VERSION),
    layout: parseLayoutPreferences(value.layout),
    keybindings
  };
}

function parseCaption(value: unknown, translationOptIn: boolean): CaptionPreferences {
  if (!isRecord(value)) return DEFAULT_CAPTION;
  return {
    source: value.source === "microphone" ? "microphone" : "system",
    language: value.language === "bilingual" || value.language === "chinese" ? value.language : "english",
    timestamps: value.timestamps === true,
    // Earlier versions enabled display by default, not translation by explicit consent.
    showChinese: translationOptIn && value.showChinese === true,
    pinned: value.pinned !== false,
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
