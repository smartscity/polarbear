import { STORAGE_KEYS } from "../constants/storageKeys";

export function readStoredDebugEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.debug) === "1";
  } catch {
    return false;
  }
}

/**
 * Diagnostics are one user-facing switch. Keep all historical diagnostic
 * surfaces in lockstep so turning Debug off cannot leave an overlay behind.
 */
export function storeDebugEnabled(enabled: boolean): void {
  try {
    const value = enabled ? "1" : "0";
    window.localStorage.setItem(STORAGE_KEYS.debug, value);
    window.localStorage.setItem(STORAGE_KEYS.liveDebug, value);
    window.localStorage.setItem(STORAGE_KEYS.liveDebugScroll, value);
    window.localStorage.setItem(STORAGE_KEYS.liveDebugPanel, value);
  } catch {
    // Debug is diagnostic-only. Storage failures must not disrupt editing.
  }
}
