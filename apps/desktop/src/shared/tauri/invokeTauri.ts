import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import type { TauriCommandId } from "./commandIds";

export class TauriCommandError extends Error {
  readonly code = "TAURI_COMMAND_FAILED";

  constructor(
    readonly command: TauriCommandId,
    readonly cause: unknown,
  ) {
    super(errorMessage(cause));
    this.name = "TauriCommandError";
  }
}

export async function invokeTauri<TResult = void>(
  command: TauriCommandId,
  args?: InvokeArgs,
): Promise<TResult> {
  try {
    return await invoke<TResult>(command, args);
  } catch (error) {
    throw new TauriCommandError(command, error);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
