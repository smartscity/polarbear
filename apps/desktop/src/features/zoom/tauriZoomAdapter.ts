import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { invokeTauri } from "../../shared/tauri/invokeTauri";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { APP_EVENTS } from "../../shared/events/appEvents";
import type { NativePinchPayload } from "./appZoomRuntime";

/** Keeps the native WebView zoom baseline aligned with the canvas zoom model. */
export function setNativeAppZoom(zoom: number): Promise<void> {
  return invokeTauri(TAURI_COMMANDS.setAppZoom, { zoom });
}

/** The disposer also owns registrations and events that arrive after teardown. */
export function subscribeNativePinch(
  onPinch: (payload: NativePinchPayload) => void,
  onError: (error: unknown) => void,
): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  const release = async (stop: UnlistenFn) => {
    try {
      // Tauri returns an asynchronous disposer despite the public void signature.
      await stop();
    } catch (error) {
      console.warn("Native pinch subscription cleanup failed", error);
    }
  };
  void listen<NativePinchPayload>(APP_EVENTS.nativePinch, (event) => {
    if (!disposed) onPinch(event.payload);
  }).then((stop) => {
    if (disposed) void release(stop);
    else unlisten = stop;
  }).catch((error: unknown) => { if (!disposed) onError(error); });
  return () => {
    if (disposed) return;
    disposed = true;
    if (unlisten) void release(unlisten);
    unlisten = undefined;
  };
}
