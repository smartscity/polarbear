import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { memoryApi } from "./memoryApi";

describe("memoryApi", () => {
  beforeEach(() => invoke.mockReset());

  it("routes typed requests through the single Rust proxy without a token or database path", async () => {
    invoke.mockResolvedValue({ items: [], offset: 0, limit: 50, nextOffset: null });
    await memoryApi.list("/repo", { query: "socket", status: "ACTIVE", limit: 50 });
    expect(invoke).toHaveBeenCalledWith("memory_admin_request", {
      workspaceRoot: "/repo",
      method: "memories.list",
      params: { query: "socket", status: "ACTIVE", limit: 50 },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/token|memory\.db/u);
  });

  it("requires the preview digest when confirming Promote", async () => {
    invoke.mockResolvedValue({ path: ".polarbear/knowledge/decision/a.md", sha256: "abc" });
    await memoryApi.promote("/repo", "memory-id", "abc");
    expect(invoke).toHaveBeenCalledWith("memory_admin_request", {
      workspaceRoot: "/repo",
      method: "knowledge.promote",
      params: { memoryId: "memory-id", expectedSha256: "abc" },
    });
  });

  it("routes maintenance and backup administration through versioned capabilities", async () => {
    invoke.mockResolvedValueOnce({ dryRun: true, actions: [] });
    await memoryApi.maintenancePreview("/repo");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo",
      method: "maintenance.preview",
      params: {},
    });

    invoke.mockResolvedValueOnce({ fileName: "memory.db", integrity: "ok" });
    await memoryApi.verifyBackup("/repo", "memory.db");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo",
      method: "backups.verify",
      params: { fileName: "memory.db" },
    });
  });

  it("never forwards a database path while loading revision history", async () => {
    invoke.mockResolvedValue({ items: [] });
    await memoryApi.history("/repo", "memory-id");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo",
      method: "memories.history",
      params: { memoryId: "memory-id" },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/memory\.db|token/u);
  });

  it("updates only the bounded project capture policy", async () => {
    invoke.mockResolvedValue({ captureMode: "manual", rawEventRetentionDays: 3, defaultContextBudget: 1000 });
    await memoryApi.updateConfig("/repo", "manual", 3);
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo",
      method: "projects.config_update",
      params: { captureMode: "manual", rawEventRetentionDays: 3 },
    });
  });
});
