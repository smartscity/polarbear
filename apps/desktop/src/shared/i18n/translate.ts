import { readUserSettings } from "../settings/userSettings";
import { enMessages } from "./locales/en";
import { zhCNMessages } from "./locales/zh-CN";

export type AppLanguage = "en" | "zh-CN";
export type MessageKey = keyof typeof enMessages;
export type TranslationValues = Record<string, string | number>;
export type Translate = (key: MessageKey, values?: TranslationValues) => string;

const messages: Record<AppLanguage, Record<MessageKey, string>> = {
  en: enMessages,
  "zh-CN": zhCNMessages
};

export function initialLanguage(): AppLanguage {
  try {
    const stored = readUserSettings().language;
    if (stored === "en" || stored === "zh-CN") {
      return stored;
    }
  } catch {
    // Storage can be unavailable in hardened WebViews; system language still works.
  }

  const systemLanguages = navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];
  return systemLanguages.some((language) => language.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en";
}

export function translate(
  language: AppLanguage,
  key: MessageKey,
  values: TranslationValues = {},
): string {
  let message = messages[language][key] ?? messages.en[key];
  Object.entries(values).forEach(([name, value]) => {
    message = message.replaceAll(`{${name}}`, String(value));
  });
  return message;
}

export function translateCurrent(
  key: MessageKey,
  values?: TranslationValues,
): string {
  const documentLanguage = document.documentElement.lang;
  const language: AppLanguage = documentLanguage === "zh-CN" ? "zh-CN" : "en";
  return translate(language, key, values);
}
