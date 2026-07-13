import { useEffect, useRef } from "react";

type UseDismissOnEscapeOptions = {
  enabled?: boolean;
};

/**
 * Gives transient UI a consistent Escape dismissal path without duplicating
 * window listener lifecycle code in every dialog and overlay.
 */
export function useDismissOnEscape(
  onDismiss: () => void,
  { enabled = true }: UseDismissOnEscapeOptions = {},
): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") {
        return;
      }
      onDismissRef.current();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
