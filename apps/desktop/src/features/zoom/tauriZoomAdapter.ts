import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { invokeTauri } from "../../shared/tauri/invokeTauri";

/** Keeps the native WebView zoom baseline aligned with the canvas zoom model. */
export function setNativeAppZoom(zoom: number): Promise<void> {
  return invokeTauri(TAURI_COMMANDS.setAppZoom, { zoom });
}
