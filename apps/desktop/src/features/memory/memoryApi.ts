import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { invokeTauri } from "../../shared/tauri/invokeTauri";
import type {
  ContextExplainResponse,
  HelloResponse,
  LifecycleStatus,
  BackupInspection,
  BackupListResponse,
  BackupRestorePreview,
  BackupRestoreResult,
  DiagnosticsResponse,
  MaintenancePlan,
  MemoryHistoryResponse,
  MemoryListResponse,
  MemoryPurgePreview,
  MemoryPurgeResult,
  MemoryRecord,
  MemoryRelationType,
  MemoryType,
  ProjectStatusResponse,
  ProjectMemoryConfig,
  PromotePreviewResponse,
  PromoteResponse,
  RecordMemoryRequest,
  TokenSavingsStats,
  VerificationState,
} from "./generated/adminV1";

async function request<T>(workspaceRoot: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return invokeTauri<T>(TAURI_COMMANDS.memoryAdminRequest, { workspaceRoot, method, params });
}

export const memoryApi = {
  bindWorkspace: (workspaceRoot: string) => invokeTauri<string>(TAURI_COMMANDS.memoryAdminBindWorkspace, { workspaceRoot }),
  serviceStatus: () => invokeTauri<{ running: boolean }>(TAURI_COMMANDS.memoryServiceStatus),
  startService: () => invokeTauri<{ running: boolean }>(TAURI_COMMANDS.memoryServiceStart),
  stopService: (workspaceRoot: string) => invokeTauri<{ stopping: boolean }>(TAURI_COMMANDS.memoryServiceStop, { workspaceRoot }),
  hello: (workspaceRoot: string) => request<HelloResponse>(workspaceRoot, "system.hello"),
  status: (workspaceRoot: string) => request<ProjectStatusResponse>(workspaceRoot, "projects.status"),
  list: (workspaceRoot: string, filters: { query?: string; status?: LifecycleStatus; type?: MemoryType; limit?: number; offset?: number }) =>
    request<MemoryListResponse>(workspaceRoot, "memories.list", filters),
  get: (workspaceRoot: string, memoryId: string) => request<MemoryRecord>(workspaceRoot, "memories.get", { memoryId }),
  record: (workspaceRoot: string, input: RecordMemoryRequest) => request<MemoryRecord>(workspaceRoot, "memories.record", input),
  history: (workspaceRoot: string, memoryId: string) => request<MemoryHistoryResponse>(workspaceRoot, "memories.history", { memoryId }),
  update: (workspaceRoot: string, memoryId: string, summary: string, content: string, reason: string) =>
    request<MemoryRecord>(workspaceRoot, "memories.update", { memoryId, summary, content, reason }),
  verify: (workspaceRoot: string, memoryId: string, state: VerificationState, reason: string) =>
    request<MemoryRecord>(workspaceRoot, "memories.verify", { memoryId, state, reason }),
  archive: (workspaceRoot: string, memoryId: string, reason: string) =>
    request<MemoryRecord>(workspaceRoot, "memories.archive", { memoryId, reason }),
  restore: (workspaceRoot: string, memoryId: string, reason: string) =>
    request<MemoryRecord>(workspaceRoot, "memories.restore", { memoryId, reason }),
  complete: (workspaceRoot: string, memoryId: string, state: "COMPLETED" | "CANCELLED", reason: string) =>
    request<MemoryRecord>(workspaceRoot, "memories.complete", { memoryId, state, reason }),
  feedback: (workspaceRoot: string, memoryId: string, useful: boolean, reason: string) =>
    request<MemoryRecord>(workspaceRoot, "memories.feedback", { memoryId, useful, reason }),
  relate: (workspaceRoot: string, sourceMemoryId: string, targetMemoryId: string, relation: MemoryRelationType, reason: string) =>
    request<{ recorded: true }>(workspaceRoot, "memories.relate", { sourceMemoryId, targetMemoryId, relation, reason }),
  purgePreview: (workspaceRoot: string, memoryId: string) =>
    request<MemoryPurgePreview>(workspaceRoot, "memories.purge_preview", { memoryId }),
  purge: (workspaceRoot: string, memoryId: string, confirmation: string, reason: string) =>
    request<MemoryPurgeResult>(workspaceRoot, "memories.purge", { memoryId, confirmation, reason }),
  explain: (workspaceRoot: string, task: string, budget = 1000) =>
    request<ContextExplainResponse>(workspaceRoot, "contexts.explain", { task, budget }),
  tokenSavings: (workspaceRoot: string) => request<TokenSavingsStats>(workspaceRoot, "usage.token_savings"),
  resetTokenSavings: (workspaceRoot: string, confirmation: "RESET") =>
    request<TokenSavingsStats>(workspaceRoot, "usage.token_savings_reset", { confirmation }),
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
  restoreBackupPreview: (workspaceRoot: string, fileName: string) => request<BackupRestorePreview>(workspaceRoot, "backups.restore_preview", { fileName }),
  restoreBackup: (workspaceRoot: string, fileName: string, confirmation: string) => request<BackupRestoreResult>(workspaceRoot, "backups.restore", { fileName, confirmation }),
};
