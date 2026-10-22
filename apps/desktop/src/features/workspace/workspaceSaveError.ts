import { hasTauriErrorCode } from "../../shared/tauri/invokeTauri";

export const WORKSPACE_SAVE_ERROR_CODES = {
  documentChanged: "workspace.documentChanged",
  documentMissing: "workspace.documentMissing",
  saveFailed: "workspace.saveFailed",
  permissionDenied: "workspace.permissionDenied",
  durabilityUncertain: "workspace.saveDurabilityUncertain",
} as const;

export type WorkspaceSaveErrorCode =
  typeof WORKSPACE_SAVE_ERROR_CODES[keyof typeof WORKSPACE_SAVE_ERROR_CODES];

export type WorkspaceDocumentSaveConflict = "changed" | "deleted";

export function hasWorkspaceSaveErrorCode(
  error: unknown,
  code: WorkspaceSaveErrorCode,
): boolean {
  return hasTauriErrorCode(error, code);
}

export function workspaceDocumentSaveConflict(
  error: unknown,
): WorkspaceDocumentSaveConflict | null {
  if (hasWorkspaceSaveErrorCode(error, WORKSPACE_SAVE_ERROR_CODES.documentChanged)) {
    return "changed";
  }
  if (hasWorkspaceSaveErrorCode(error, WORKSPACE_SAVE_ERROR_CODES.documentMissing)) {
    return "deleted";
  }
  return null;
}

export function workspaceSaveFailureKey(error: unknown) {
  if (hasWorkspaceSaveErrorCode(error, WORKSPACE_SAVE_ERROR_CODES.permissionDenied)) {
    return "status.savePermissionDenied" as const;
  }
  if (hasWorkspaceSaveErrorCode(error, WORKSPACE_SAVE_ERROR_CODES.durabilityUncertain)) {
    return "status.saveDurabilityUncertain" as const;
  }
  return null;
}
