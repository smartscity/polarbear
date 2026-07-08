import { invoke } from "@tauri-apps/api/core";

export async function openNewAppWindow(): Promise<void> {
  await invoke("open_new_app_window");
}
