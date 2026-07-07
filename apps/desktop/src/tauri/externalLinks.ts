import { invoke } from "@tauri-apps/api/core";

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await invoke("open_external_url", { url });
    return;
  } catch {
    // Browser fallback for non-Tauri test environments.
  }

  const openedWindow = window.open(url, "_blank", "noopener,noreferrer");
  if (!openedWindow) {
    window.location.href = url;
  }
}
