import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { memoryApi } from "./memoryApi";

describe("memoryApi", () => {
  beforeEach(() => invoke.mockReset());

  it("binds the native proxy to the current Desktop workspace", async () => {
    invoke.mockResolvedValue("/repo");
    await memoryApi.bindWorkspace("/repo");
    expect(invoke).toHaveBeenCalledWith("memory_admin_bind_workspace", { workspaceRoot: "/repo" });
  });

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

  it("routes V2 creation, completion, feedback and token savings through the versioned Admin API", async () => {
    invoke.mockResolvedValue({ id: "memory-id" });
    await memoryApi.record("/repo", {
      type: "ARCHITECTURE",
      summary: "Desktop uses the Engine API",
      validFrom: "2026-08-29T00:00:00.000Z",
      entities: [{ kind: "MODULE", canonicalKey: "desktop:memory", displayName: "Desktop Memory" }],
    });
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo",
      method: "memories.record",
      params: expect.objectContaining({ type: "ARCHITECTURE", summary: "Desktop uses the Engine API" }),
    });
    await memoryApi.complete("/repo", "memory-id", "COMPLETED", "implemented");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "memories.complete", params: { memoryId: "memory-id", state: "COMPLETED", reason: "implemented" },
    });
    await memoryApi.feedback("/repo", "memory-id", true, "useful");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "memories.feedback", params: { memoryId: "memory-id", useful: true, reason: "useful" },
    });
    await memoryApi.tokenSavings("/repo");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "usage.token_savings", params: {},
    });
    await memoryApi.resetTokenSavings("/repo", "RESET");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "usage.token_savings_reset", params: { confirmation: "RESET" },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/memory\.db|tokenFile|authToken/u);
  });

  it("routes Context OS task, history, packet and metrics operations through Admin API 1.4", async () => {
    invoke.mockResolvedValue({ id: "task-id" });
    await memoryApi.createTask("/repo", { title: "Retry", objective: "Implement retry", phase: "IMPLEMENTATION" });
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "tasks.create",
      params: { title: "Retry", objective: "Implement retry", phase: "IMPLEMENTATION" },
    });
    await memoryApi.checkpointTask("/repo", {
      taskId: "task-id", status: "ACTIVE", phase: "IMPLEMENTATION", summary: "Boundary",
      state: { changed: [], learned: [], decisionsAdded: [], constraintsAdded: [], failedAttempts: [], filesChanged: [], verification: [], unresolved: [], remaining: [] },
    });
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", expect.objectContaining({ method: "tasks.checkpoint" }));
    await memoryApi.buildContextPacket("/repo", { taskId: "task-id", currentRequest: "Continue", maxTokens: 2_000 });
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "contexts.build",
      params: { taskId: "task-id", currentRequest: "Continue", maxTokens: 2_000 },
    });
    await memoryApi.currentContextPacket("/repo");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "contexts.current", params: {},
    });
    await memoryApi.contextOsMetrics("/repo", "task-id");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "usage.context_os", params: { taskId: "task-id" },
    });
    await memoryApi.listTaskCheckpoints("/repo", "task-id");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "tasks.checkpoints", params: { taskId: "task-id", limit: 20 },
    });
    await memoryApi.listTaskRuns("/repo", "task-id");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "tasks.runs", params: { taskId: "task-id", limit: 20 },
    });
    await memoryApi.getTaskRunContext("/repo", "task-id", "run-id");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "tasks.run_context", params: { taskId: "task-id", runId: "run-id" },
    });
    await memoryApi.agentConnections("/repo");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "agents.connections", params: {},
    });
    await memoryApi.agentIntegrations("/repo");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "agents.integrations", params: {},
    });
    await memoryApi.repairAgentIntegration("/repo", "codex");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "agents.integrations_repair", params: { integration: "codex" },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/memory\.db|tokenFile|authToken/u);
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

  it("updates the bounded project Context policy", async () => {
    const config = {
      captureMode: "manual" as const,
      rawEventRetentionDays: 30,
      contextBudgetMode: "custom" as const,
      defaultContextBudget: 2400,
    };
    invoke.mockResolvedValue(config);
    await memoryApi.updateConfig("/repo", config);
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo",
      method: "projects.config_update",
      params: config,
    });
  });

  it("requires an explicit restore confirmation string", async () => {
    invoke.mockResolvedValue({ restored: { fileName: "known-good.db" }, rollbackFileName: "pre-restore.db" });
    await memoryApi.restoreBackup("/repo", "known-good.db", "RESTORE known-good.db");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo",
      method: "backups.restore",
      params: { fileName: "known-good.db", confirmation: "RESTORE known-good.db" },
    });
  });

  it("routes edits and exact-confirmation purge without exposing storage", async () => {
    invoke.mockResolvedValueOnce({ id: "memory-id", summary: "new", content: "content" });
    await memoryApi.update("/repo", "memory-id", "new", "content", "fix stale detail");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo",
      method: "memories.update",
      params: { memoryId: "memory-id", summary: "new", content: "content", reason: "fix stale detail" },
    });
    invoke.mockResolvedValueOnce({ id: "memory-id", lifecycleStatus: "REJECTED" });
    await memoryApi.reject("/repo", "memory-id", "incorrect");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo", method: "memories.reject", params: { memoryId: "memory-id", reason: "incorrect" },
    });
    invoke.mockResolvedValueOnce({ purgedMemoryIdHash: "hash" });
    await memoryApi.purge("/repo", "memory-id", "PURGE memory-id", "user request");
    expect(invoke).toHaveBeenLastCalledWith("memory_admin_request", {
      workspaceRoot: "/repo",
      method: "memories.purge",
      params: { memoryId: "memory-id", confirmation: "PURGE memory-id", reason: "user request" },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/memory\.db|token/u);
  });
});
