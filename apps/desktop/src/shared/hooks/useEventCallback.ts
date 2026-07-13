import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Keeps an event handler's identity stable while always invoking the latest
 * implementation after React has committed it. Use this for long-lived native
 * listeners and Tauri callbacks so ordinary editor renders do not re-register
 * global handlers.
 */
export function useEventCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const callbackRef = useRef(callback);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  return useCallback((...args: Args) => callbackRef.current(...args), []);
}
