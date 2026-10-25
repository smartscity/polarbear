import { useEffect, useState } from "react";
import { APP_EVENTS } from "../events/appEvents";
import { initializeUserSettings, readUserSettings, type UserSettings } from "./userSettings";

export function useUserSettings(): UserSettings {
  const [settings, setSettings] = useState(readUserSettings);

  useEffect(() => {
    const handleSettingsChanged = () => setSettings(readUserSettings());
    window.addEventListener(APP_EVENTS.settingsChanged, handleSettingsChanged);
    window.addEventListener("storage", handleSettingsChanged);
    handleSettingsChanged();
    void initializeUserSettings().catch(() => {
      // Keep the legacy projection readable. Explicit writes surface their own failure.
    });
    return () => {
      window.removeEventListener(APP_EVENTS.settingsChanged, handleSettingsChanged);
      window.removeEventListener("storage", handleSettingsChanged);
    };
  }, []);

  return settings;
}
