import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { updateUserSettings } from "../settings/userSettings";
import {
  initialLanguage,
  languageDirection,
  localeOptions,
  translate,
  type AppLanguage,
  type LocaleOption,
  type Translate,
} from "./translate";

export type {
  AppLanguage,
  MessageKey,
  Translate,
  TranslationValues,
} from "./translate";

type I18nContextValue = {
  language: AppLanguage;
  languages: readonly LocaleOption[];
  setLanguage: (language: AppLanguage) => void;
  t: Translate;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = languageDirection(language);
  }, [language]);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    try {
      updateUserSettings({ language: nextLanguage });
    } catch {
      // Keep the active session switch working even if persistence is blocked.
    }
    setLanguageState(nextLanguage);
  }, []);

  const t = useCallback<Translate>(
    (key, values) => translate(language, key, values),
    [language]
  );

  const value = useMemo(
    () => ({ language, languages: localeOptions, setLanguage, t }),
    [language, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}
