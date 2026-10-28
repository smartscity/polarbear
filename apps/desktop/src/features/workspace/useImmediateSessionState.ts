import { useCallback, useRef, useState, type SetStateAction } from "react";

/**
 * Owns an imperative session value and projects it into React. Native completions
 * must see earlier mutations even when React batches their renders in one task.
 * Mutations belong to event/completion handlers, never render or state updaters.
 */
export function useImmediateSessionState<T>(initial: T) {
  const [value, projectValue] = useState(initial);
  const current = useRef(value);
  const setValue = useCallback((update: SetStateAction<T>) => {
    const next = typeof update === "function"
      ? (update as (previous: T) => T)(current.current)
      : update;
    current.current = next;
    projectValue(next);
  }, []);
  return [value, setValue, current] as const;
}
