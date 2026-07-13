import { describe, expect, it } from "vitest";
import {
  TauriCommandError,
  errorMessage,
  hasTauriErrorCode,
  toTauriErrorEnvelope,
} from "./invokeTauri";

describe("toTauriErrorEnvelope", () => {
  it("keeps existing string errors readable", () => {
    expect(toTauriErrorEnvelope("Unable to save file.")).toEqual({
      message: "Unable to save file.",
    });
  });

  it("reads structured errors returned as an IPC object or JSON string", () => {
    const expected = {
      code: "workspace.documentChanged",
      message: "The document changed outside Polarbear.",
    };

    expect(toTauriErrorEnvelope(expected)).toEqual(expected);
    expect(toTauriErrorEnvelope(JSON.stringify(expected))).toEqual(expected);
  });

  it("keeps a structured error code on the command error", () => {
    const error = new TauriCommandError("save_markdown_file", {
      code: "workspace.documentMissing",
      message: "The document was deleted outside Polarbear.",
    });

    expect(errorMessage(error)).toBe("The document was deleted outside Polarbear.");
    expect(hasTauriErrorCode(error, "workspace.documentMissing")).toBe(true);
  });
});
