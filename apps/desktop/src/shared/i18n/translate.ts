import { readUserSettings } from "../settings/userSettings";
import {
  parseLocaleProperties,
  type LocaleMessages,
} from "./localeProperties";

export type AppLanguage = string;
export type MessageKey = string;
export type TranslationValues = Record<string, string | number>;
export type Translate = (key: MessageKey, values?: TranslationValues) => string;
export type LocaleOption = {
  code: AppLanguage;
  direction: "ltr" | "rtl";
  label: string;
};

const localeSources = import.meta.glob("./locales/*.properties", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const messages = Object.fromEntries(
  Object.entries(localeSources).map(([path, source]) => [
    languageFromLocalePath(path),
    parseLocaleProperties(source),
  ]),
) as Record<AppLanguage, LocaleMessages>;

const fallbackLanguage = "en";

if (!messages[fallbackLanguage]) {
  throw new Error("Missing required i18n fallback locale: en.properties.");
}

export const localeOptions: readonly LocaleOption[] = Object.entries(messages)
  .map(([code, catalog]) => ({
    code,
    direction: catalog["locale.direction"] === "rtl" ? "rtl" : "ltr",
    label: catalog["locale.name"] ?? code,
  }))
  .sort(({ code: left }, { code: right }) => left.localeCompare(right));

export function isSupportedLanguage(value: string): value is AppLanguage {
  return Object.hasOwn(messages, value);
}

export function languageDirection(language: AppLanguage): "ltr" | "rtl" {
  return messages[resolveLanguage(language)]?.["locale.direction"] === "rtl"
    ? "rtl"
    : "ltr";
}

export function localeMessages(language: AppLanguage): LocaleMessages {
  return messages[resolveLanguage(language)];
}

export function initialLanguage(): AppLanguage {
  try {
    const stored = readUserSettings().language;
    if (stored !== "system" && isSupportedLanguage(stored)) {
      return stored;
    }
  } catch {
    // Storage can be unavailable in hardened WebViews; system language still works.
  }

  const systemLanguages = navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];
  return resolveLanguage(systemLanguages[0] ?? fallbackLanguage);
}

export function translate(
  language: AppLanguage,
  key: MessageKey,
  values: TranslationValues = {},
): string {
  let message = messages[resolveLanguage(language)]?.[key]
    ?? messages[fallbackLanguage][key]
    ?? key;
  Object.entries(values).forEach(([name, value]) => {
    message = message.replaceAll(`{${name}}`, String(value));
  });
  return message;
}

export function translateCurrent(
  key: MessageKey,
  values?: TranslationValues,
): string {
  const documentLanguage = document.documentElement.lang || fallbackLanguage;
  const language = resolveLanguage(documentLanguage);
  return translate(language, key, values);
}

function resolveLanguage(language: string): AppLanguage {
  if (isSupportedLanguage(language)) {
    return language;
  }

  const normalizedLanguage = language.toLowerCase();
  const exactMatch = localeOptions.find(
    ({ code }) => code.toLowerCase() === normalizedLanguage,
  );
  if (exactMatch) {
    return exactMatch.code;
  }

  const baseLanguage = normalizedLanguage.split("-")[0];
  const baseMatch = localeOptions.find(
    ({ code }) => code.toLowerCase().split("-")[0] === baseLanguage,
  );
  return baseMatch?.code ?? fallbackLanguage;
}

function languageFromLocalePath(path: string): AppLanguage {
  const match = path.match(/\/([^/]+)\.properties$/);
  if (!match) {
    throw new Error(`Unable to derive a language code from locale path: ${path}`);
  }
  return match[1];
}
