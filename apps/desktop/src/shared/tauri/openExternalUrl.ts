import { TAURI_COMMANDS } from "./commandIds";
import { invokeTauri } from "./invokeTauri";

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await invokeTauri(TAURI_COMMANDS.openExternalUrl, { url });
    return;
  } catch {
    // Browser fallback for non-Tauri test environments.
  }

  const openedWindow = window.open(url, "_blank", "noopener,noreferrer");
  if (!openedWindow) {
    window.location.href = url;
  }
}
