import { describe, expect, it } from "vitest";
import { getCommandState, type CommandRuntimeContext } from "./commandState";

const defaultContext: CommandRuntimeContext = {
  activeDocumentId: "guide.md",
  activeViewMode: "live",
  repositoryBusy: false,
  repositoryConnected: false,
  repositoryLinked: false,
  selectedTreeItemId: "guide.md",
  sidebarOpen: true,
  theme: "light",
  workspaceOpen: true,
};

describe("getCommandState", () => {
  it("disables document commands when no document is active", () => {
    const context = { ...defaultContext, activeDocumentId: "" };

    expect(getCommandState("file.save", context).enabled).toBe(false);
    expect(getCommandState("format.bold", context).enabled).toBe(false);
    expect(getCommandState("file.openFile", context).enabled).toBe(true);
  });

  it("keeps cloud sync unavailable until a workspace is linked", () => {
    expect(getCommandState("repository.syncNow", defaultContext)).toMatchObject({
      enabled: false,
      visible: false,
    });
    expect(getCommandState("repository.connectGithub", defaultContext)).toMatchObject({
      enabled: true,
      visible: true,
    });
  });

  it("reports checked state for the active view and theme", () => {
    expect(getCommandState("view.liveEdit", defaultContext).checked).toBe(true);
    expect(getCommandState("view.preview", defaultContext).checked).toBe(false);
    expect(getCommandState("theme.light", defaultContext).checked).toBe(true);
    expect(getCommandState("theme.dark", defaultContext).checked).toBe(false);
  });

  it("uses the active document as a file command fallback outside the tree", () => {
    const context = { ...defaultContext, selectedTreeItemId: "" };

    expect(getCommandState("file.rename", context).enabled).toBe(true);
    expect(getCommandState("file.delete", context).enabled).toBe(true);
    expect(getCommandState("file.duplicate", context).enabled).toBe(true);
    expect(getCommandState("workspace.refresh", context).enabled).toBe(true);
  });

  it("disables file operations when no tree item or document exists", () => {
    const context = {
      ...defaultContext,
      activeDocumentId: "",
      selectedTreeItemId: "",
    };

    expect(getCommandState("file.rename", context).enabled).toBe(false);
  });
});
