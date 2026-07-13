import { TAURI_COMMANDS } from "./commandIds";
import { invokeTauri } from "./invokeTauri";

/** Requests a process-level quit only after the frontend resolves dirty documents. */
export async function quitApp(): Promise<void> {
  await invokeTauri(TAURI_COMMANDS.quitApp);
}
