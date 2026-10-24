import { useEffect, type RefObject } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RepositorySyncProgress } from "./repositoryApi";
import { APP_EVENTS } from "../../shared/events/appEvents";

type RepositorySyncProgressOptions = {
  busyRef: RefObject<boolean>;
  onProgress: (progress: RepositorySyncProgress) => void;
  onError: (error: unknown) => void;
};

export function useRepositorySyncProgress({
  busyRef,
  onProgress,
  onError,
}: RepositorySyncProgressOptions): void {
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;

    void listen<RepositorySyncProgress>(
      APP_EVENTS.repositorySyncProgress,
      ({ payload }) => {
        if (!disposed && busyRef.current) {
          onProgress(payload);
        }
      },
    ).then((stopListening) => {
      if (disposed) {
        stopListening();
      } else {
        unlisten = stopListening;
      }
    }).catch((error: unknown) => {
      if (!disposed) onError(error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [busyRef, onProgress, onError]);
}
