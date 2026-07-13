import { useEffect, useState } from "react";
import { APP_EVENTS } from "../events/appEvents";
import { readStoredDebugEnabled } from "./debugSettings";

/** Keeps temporary diagnostics in sync with the status-bar Debug switch. */
export function useStoredDebugEnabled(): boolean {
  const [debugEnabled, setDebugEnabled] = useState(readStoredDebugEnabled);

  useEffect(() => {
    const syncDebugEnabled = () => setDebugEnabled(readStoredDebugEnabled());
    window.addEventListener(APP_EVENTS.debugChanged, syncDebugEnabled);
    return () => window.removeEventListener(APP_EVENTS.debugChanged, syncDebugEnabled);
  }, []);

  return debugEnabled;
}
