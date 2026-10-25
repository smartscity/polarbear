import { useEffect, useRef, useState, type SetStateAction } from "react";
import { useEventCallback } from "../../shared/hooks/useEventCallback";
import { APP_EVENTS } from "../../shared/events/appEvents";
import { readUserSettings, updateUserSettings } from "../../shared/settings/userSettings";
import { DEFAULT_LAYOUT, type LayoutPreferences } from "../../shared/settings/layoutPreferences";

export function useLayoutPreferences(onStorageError: () => void) {
  const [preferences, setPreferences] = useState(() => readUserSettings().layout);
  const current = useRef(preferences);
  const optimistic = useRef<Partial<LayoutPreferences>>({});
  const revisions = useRef<Partial<Record<keyof LayoutPreferences, number>>>({});
  const generation = useRef(0);
  const refresh = useEventCallback(() => {
    const next = { ...readUserSettings().layout, ...optimistic.current };
    current.current = next;
    setPreferences(next);
  });
  const update = useEventCallback((patch: Partial<LayoutPreferences>) => {
    const revision = ++generation.current;
    const keys = Object.keys(patch) as (keyof LayoutPreferences)[];
    for (const key of keys) revisions.current[key] = revision;
    optimistic.current = { ...optimistic.current, ...patch };
    const next = { ...current.current, ...patch };
    current.current = next;
    setPreferences(next);
    void updateUserSettings({ layout: patch }).then(() => {
      for (const key of keys) if (revisions.current[key] === revision) delete optimistic.current[key];
      refresh();
    }).catch(onStorageError);
  });
  useEffect(() => {
    window.addEventListener(APP_EVENTS.settingsChanged, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(APP_EVENTS.settingsChanged, refresh); window.removeEventListener("storage", refresh); };
  }, [refresh]);
  const setLeftOpen = (value: SetStateAction<boolean>) => update({ leftOpen: typeof value === "function" ? value(current.current.leftOpen) : value });
  const setRightOpen = (value: SetStateAction<boolean>) => update({ rightOpen: typeof value === "function" ? value(current.current.rightOpen) : value });
  return { preferences, update, setLeftOpen, setRightOpen, reset: () => update(DEFAULT_LAYOUT) };
}
