import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { invokeTauri } from "../../shared/tauri/invokeTauri";
import type {
  ContextExplainResponse,
  HelloResponse,
  LifecycleStatus,
  BackupInspection,
  BackupListResponse,
  DiagnosticsResponse,
  MaintenancePlan,
  MemoryHistoryResponse,
  MemoryListResponse,
  MemoryRecord,
  MemoryType,
  ProjectStatusResponse,
  ProjectMemoryConfig,
  PromotePreviewResponse,
  PromoteResponse,
  VerificationState,
} from "./generated/adminV1";

async function request<T>(workspaceRoot: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return invokeTauri<T>(TAURI_COMMANDS.memoryAdminRequest, { workspaceRoot, method, params });
}

export const memoryApi = {
  hello: (workspaceRoot: string) => request<HelloResponse>(workspaceRoot, "system.hello"),
  status: (workspaceRoot: string) => request<ProjectStatusResponse>(workspaceRoot, "projects.status"),
  list: (workspaceRoot: string, filters: { query?: string; status?: LifecycleStatus; type?: MemoryType; limit?: number; offset?: number }) =>
    request<MemoryListResponse>(workspaceRoot, "memories.list", filters),
  get: (workspaceRoot: string, memoryId: string) => request<MemoryRecord>(workspaceRoot, "memories.get", { memoryId }),
  history: (workspaceRoot: string, memoryId: string) => request<MemoryHistoryResponse>(workspaceRoot, "memories.history", { memoryId }),
  verify: (workspaceRoot: string, memoryId: string, state: VerificationState, reason: string) =>
    request<MemoryRecord>(workspaceRoot, "memories.verify", { memoryId, state, reason }),
  archive: (workspaceRoot: string, memoryId: string, reason: string) =>
    request<MemoryRecord>(workspaceRoot, "memories.archive", { memoryId, reason }),
  restore: (workspaceRoot: string, memoryId: string, reason: string) =>
    request<MemoryRecord>(workspaceRoot, "memories.restore", { memoryId, reason }),
  relate: (workspaceRoot: string, sourceMemoryId: string, targetMemoryId: string, relation: "SUPERSEDES" | "CONTRADICTS", reason: string) =>
    request<{ recorded: true }>(workspaceRoot, "memories.relate", { sourceMemoryId, targetMemoryId, relation, reason }),
  explain: (workspaceRoot: string, task: string, budget = 1000) =>
    request<ContextExplainResponse>(workspaceRoot, "contexts.explain", { task, budget }),
  promotePreview: (workspaceRoot: string, memoryId: string) =>
    request<PromotePreviewResponse>(workspaceRoot, "knowledge.promote_preview", { memoryId }),
  promote: (workspaceRoot: string, memoryId: string, expectedSha256: string) =>
    request<PromoteResponse>(workspaceRoot, "knowledge.promote", { memoryId, expectedSha256 }),
  diagnostics: (workspaceRoot: string) => request<DiagnosticsResponse>(workspaceRoot, "projects.diagnostics"),
  config: (workspaceRoot: string) => request<ProjectMemoryConfig>(workspaceRoot, "projects.config"),
  updateConfig: (workspaceRoot: string, captureMode: ProjectMemoryConfig["captureMode"], rawEventRetentionDays: number) =>
    request<ProjectMemoryConfig>(workspaceRoot, "projects.config_update", { captureMode, rawEventRetentionDays }),
  maintenancePreview: (workspaceRoot: string) => request<MaintenancePlan>(workspaceRoot, "maintenance.preview"),
  maintenanceRun: (workspaceRoot: string) => request<MaintenancePlan>(workspaceRoot, "maintenance.run"),
  backups: (workspaceRoot: string) => request<BackupListResponse>(workspaceRoot, "backups.list"),
  createBackup: (workspaceRoot: string) => request<BackupInspection>(workspaceRoot, "backups.create"),
  verifyBackup: (workspaceRoot: string, fileName: string) => request<BackupInspection>(workspaceRoot, "backups.verify", { fileName }),
};
