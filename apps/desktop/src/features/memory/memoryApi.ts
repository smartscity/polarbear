import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { invokeTauri } from "../../shared/tauri/invokeTauri";
import type {
  AgentConnectionListResponse,
  AgentIntegrationListResponse,
  ContextExplainResponse,
  ContextExplanation,
  ContextOsMetrics,
  ContextPacket,
  CurrentContextResponse,
  CheckpointState,
  HelloResponse,
  LifecycleMetrics,
  LifecycleStatus,
  BackupInspection,
  BackupListResponse,
  BackupRestorePreview,
  BackupRestoreResult,
  DiagnosticsResponse,
  TaskCheckpointListResponse,
  TaskRunContext,
  TaskRunListResponse,
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
  TaskCheckpoint,
  TaskPhase,
  TaskRecord,
  TaskStatus,
  VerificationState,
} from "./generated/adminV1";

async function request<T>(workspaceRoot: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return invokeTauri<T>(TAURI_COMMANDS.memoryAdminRequest, { workspaceRoot, method, params });
}

export const memoryApi = {
  bindWorkspace: (workspaceRoot: string) => invokeTauri<string>(TAURI_COMMANDS.memoryAdminBindWorkspace, { workspaceRoot }),
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
  reject: (workspaceRoot: string, memoryId: string, reason: string) =>
    request<MemoryRecord>(workspaceRoot, "memories.reject", { memoryId, reason }),
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
  listTasks: (workspaceRoot: string, status?: TaskStatus) =>
    request<{ items: TaskRecord[] }>(workspaceRoot, "tasks.list", { ...(status ? { status } : {}) }),
  getTask: (workspaceRoot: string, taskId: string) => request<TaskRecord>(workspaceRoot, "tasks.get", { taskId }),
  createTask: (workspaceRoot: string, input: { title: string; objective: string; phase?: TaskPhase; priority?: number }) =>
    request<TaskRecord>(workspaceRoot, "tasks.create", input),
  checkpointTask: (workspaceRoot: string, input: {
    taskId: string; status: TaskStatus; phase: TaskPhase; summary: string; state: CheckpointState; idempotencyKey?: string;
  }) => request<TaskCheckpoint>(workspaceRoot, "tasks.checkpoint", input),
  listTaskCheckpoints: (workspaceRoot: string, taskId: string, limit = 20) =>
    request<TaskCheckpointListResponse>(workspaceRoot, "tasks.checkpoints", { taskId, limit }),
  listTaskRuns: (workspaceRoot: string, taskId: string, limit = 20) =>
    request<TaskRunListResponse>(workspaceRoot, "tasks.runs", { taskId, limit }),
  getTaskRunContext: (workspaceRoot: string, taskId: string, runId: string) =>
    request<TaskRunContext>(workspaceRoot, "tasks.run_context", { taskId, runId }),
  agentConnections: (workspaceRoot: string) =>
    request<AgentConnectionListResponse>(workspaceRoot, "agents.connections"),
  agentIntegrations: (workspaceRoot: string) =>
    request<AgentIntegrationListResponse>(workspaceRoot, "agents.integrations"),
  repairAgentIntegration: (workspaceRoot: string, integration: "codex" | "claude-code") =>
    request<AgentIntegrationListResponse>(workspaceRoot, "agents.integrations_repair", { integration }),
  buildContextPacket: (workspaceRoot: string, input: {
    currentRequest: string; taskId?: string; maxTokens?: number; provider?: string;
  }) => request<ContextPacket>(workspaceRoot, "contexts.build", input),
  currentContextPacket: (workspaceRoot: string) =>
    request<CurrentContextResponse>(workspaceRoot, "contexts.current"),
  explainContextPacket: (workspaceRoot: string, packetId: string) =>
    request<ContextExplanation>(workspaceRoot, "contexts.packet_explain", { packetId }),
  contextOsMetrics: (workspaceRoot: string, taskId?: string) =>
    request<ContextOsMetrics>(workspaceRoot, "usage.context_os", { ...(taskId ? { taskId } : {}) }),
  lifecycleMetrics: (workspaceRoot: string) =>
    request<LifecycleMetrics>(workspaceRoot, "usage.lifecycle"),
  distillObservations: (workspaceRoot: string, limit = 200) =>
    request<{ observations: number; candidates: number; recorded: number }>(workspaceRoot, "observations.distill", { limit }),
  tokenSavings: (workspaceRoot: string) => request<TokenSavingsStats>(workspaceRoot, "usage.token_savings"),
  resetTokenSavings: (workspaceRoot: string, confirmation: "RESET") =>
    request<TokenSavingsStats>(workspaceRoot, "usage.token_savings_reset", { confirmation }),
  promotePreview: (workspaceRoot: string, memoryId: string) =>
    request<PromotePreviewResponse>(workspaceRoot, "knowledge.promote_preview", { memoryId }),
  promote: (workspaceRoot: string, memoryId: string, expectedSha256: string) =>
    request<PromoteResponse>(workspaceRoot, "knowledge.promote", { memoryId, expectedSha256 }),
  diagnostics: (workspaceRoot: string) => request<DiagnosticsResponse>(workspaceRoot, "projects.diagnostics"),
  config: (workspaceRoot: string) => request<ProjectMemoryConfig>(workspaceRoot, "projects.config"),
  updateConfig: (workspaceRoot: string, config: ProjectMemoryConfig) =>
    request<ProjectMemoryConfig>(workspaceRoot, "projects.config_update", config),
  maintenancePreview: (workspaceRoot: string) => request<MaintenancePlan>(workspaceRoot, "maintenance.preview"),
  maintenanceRun: (workspaceRoot: string) => request<MaintenancePlan>(workspaceRoot, "maintenance.run"),
  backups: (workspaceRoot: string) => request<BackupListResponse>(workspaceRoot, "backups.list"),
  createBackup: (workspaceRoot: string) => request<BackupInspection>(workspaceRoot, "backups.create"),
  verifyBackup: (workspaceRoot: string, fileName: string) => request<BackupInspection>(workspaceRoot, "backups.verify", { fileName }),
  restoreBackupPreview: (workspaceRoot: string, fileName: string) => request<BackupRestorePreview>(workspaceRoot, "backups.restore_preview", { fileName }),
  restoreBackup: (workspaceRoot: string, fileName: string, confirmation: string) => request<BackupRestoreResult>(workspaceRoot, "backups.restore", { fileName, confirmation }),
};
