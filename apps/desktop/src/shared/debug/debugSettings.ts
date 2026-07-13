import { STORAGE_KEYS } from "../constants/storageKeys";

export function readStoredDebugEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.debug) === "1";
  } catch {
    return false;
  }
}
