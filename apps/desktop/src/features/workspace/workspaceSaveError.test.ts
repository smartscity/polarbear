import { describe, expect, it } from "vitest";
import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { TauriCommandError } from "../../shared/tauri/invokeTauri";
import { workspaceDocumentSaveConflict, workspaceSaveFailureKey } from "./workspaceSaveError";

describe("workspaceDocumentSaveConflict", () => {
  it("maps stable Tauri save error codes to document conflict states", () => {
    expect(workspaceDocumentSaveConflict(new TauriCommandError(
      TAURI_COMMANDS.saveMarkdownFile,
      { code: "workspace.documentChanged", message: "changed" },
    ))).toBe("changed");
    expect(workspaceDocumentSaveConflict(new TauriCommandError(
      TAURI_COMMANDS.saveMarkdownFile,
      { code: "workspace.documentMissing", message: "missing" },
    ))).toBe("deleted");
  });

  it("does not treat unexpected save failures as document conflicts", () => {
    expect(workspaceDocumentSaveConflict(new TauriCommandError(
      TAURI_COMMANDS.saveMarkdownFile,
      { code: "workspace.saveFailed", message: "permission denied" },
    ))).toBeNull();
  });

  it("maps permission and uncertain durability failures without treating them as conflicts", () => {
    for (const [code, key] of [
      ["workspace.permissionDenied", "status.savePermissionDenied"],
      ["workspace.saveDurabilityUncertain", "status.saveDurabilityUncertain"],
    ]) {
      const error = new TauriCommandError(TAURI_COMMANDS.saveMarkdownFile, { code, message: "native detail" });
      expect(workspaceSaveFailureKey(error)).toBe(key);
      expect(workspaceDocumentSaveConflict(error)).toBeNull();
    }
    expect(workspaceSaveFailureKey(new Error("unclassified"))).toBeNull();
  });
});
