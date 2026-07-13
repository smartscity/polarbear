import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import type { TauriCommandId } from "./commandIds";

export type TauriErrorEnvelope = {
  code?: string;
  message: string;
};

export class TauriCommandError extends Error {
  readonly code: string;
  readonly envelope: TauriErrorEnvelope;

  constructor(
    readonly command: TauriCommandId,
    readonly cause: unknown,
  ) {
    const envelope = toTauriErrorEnvelope(cause);
    super(envelope.message);
    this.name = "TauriCommandError";
    this.code = envelope.code ?? "TAURI_COMMAND_FAILED";
    this.envelope = envelope;
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
  return toTauriErrorEnvelope(error).message;
}

export function hasTauriErrorCode(error: unknown, code: string): boolean {
  return error instanceof TauriCommandError && error.code === code;
}

export function toTauriErrorEnvelope(error: unknown): TauriErrorEnvelope {
  if (error instanceof Error) {
    return {
      code: error instanceof TauriCommandError ? error.code : undefined,
      message: error.message,
    };
  }

  const parsed = parseErrorEnvelope(error);
  if (parsed) {
    return parsed;
  }

  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

function parseErrorEnvelope(error: unknown): TauriErrorEnvelope | null {
  if (typeof error === "string") {
    try {
      return parseErrorEnvelope(JSON.parse(error));
    } catch {
      return { message: error };
    }
  }

  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.message !== "string") {
    return null;
  }

  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    message: candidate.message,
  };
}
