import { useEffect, useRef, useState, type SetStateAction } from "react";
import { useEventCallback } from "../../shared/hooks/useEventCallback";
import { APP_EVENTS } from "../../shared/events/appEvents";
import { readUserSettings, updateUserSettings } from "../../shared/settings/userSettings";
import { DEFAULT_LAYOUT, type LayoutPreferences } from "../../shared/settings/layoutPreferences";

export function useLayoutPreferences(onStorageError: () => void) {
  const [preferences, setPreferences] = useState(() => readUserSettings().layout);
  const current = useRef(preferences);
  const persisted = useRef(preferences);
  const update = useEventCallback((patch: Partial<LayoutPreferences>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setPreferences(next);
    try { updateUserSettings({ layout: next }); persisted.current = next; } catch { onStorageError(); }
  });
  useEffect(() => {
    const refresh = () => {
      const next = readUserSettings().layout;
      if (JSON.stringify(next) === JSON.stringify(persisted.current)) return;
      persisted.current = next;
      current.current = next; setPreferences(next);
    };
    window.addEventListener(APP_EVENTS.settingsChanged, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(APP_EVENTS.settingsChanged, refresh); window.removeEventListener("storage", refresh); };
  }, []);
  const setLeftOpen = (value: SetStateAction<boolean>) => update({ leftOpen: typeof value === "function" ? value(current.current.leftOpen) : value });
  const setRightOpen = (value: SetStateAction<boolean>) => update({ rightOpen: typeof value === "function" ? value(current.current.rightOpen) : value });
  return { preferences, update, setLeftOpen, setRightOpen, reset: () => update(DEFAULT_LAYOUT) };
}
