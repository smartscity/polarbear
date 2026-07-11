import { TAURI_COMMANDS } from "./commandIds";
import { invokeTauri } from "./invokeTauri";

export async function openNewAppWindow(): Promise<void> {
  await invokeTauri(TAURI_COMMANDS.openNewAppWindow);
}
