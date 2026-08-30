import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../../shared/tauri/invokeTauri";
import type {
  AgentConnectionStatus,
  ContextExplanation,
  ContextOsMetrics,
  ContextPacket,
  ExecutionRun,
  HelloResponse,
  MemoryRelationType,
  MemoryRecord,
  ProjectMemoryConfig,
  ProjectStatusResponse,
  TaskCheckpoint,
  TaskPhase,
  TaskRecord,
  TaskRunContext,
  TaskStatus,
  TokenSavingsStats,
} from "../generated/adminV1";
import { negotiateMemoryCapabilities } from "../memoryCapabilities";
import { memoryApi } from "../memoryApi";

type TaskActivity = {
  checkpoints: TaskCheckpoint[];
  runs: ExecutionRun[];
};

type TaskRunInspection = {
  context: TaskRunContext;
  explanation: ContextExplanation | null;
};

type CreateTaskInput = {
  title: string;
  objective: string;
  phase: TaskPhase;
};

type CheckpointInput = {
  taskId: string;
  status: TaskStatus;
  phase: TaskPhase;
  summary: string;
  nextSteps: string[];
};

export function useContextOsSession(workspaceRoot: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState("");
  const [availableCapabilities, setAvailableCapabilities] = useState<ReadonlySet<string>>(() => new Set());
  const [hello, setHello] = useState<HelloResponse | null>(null);
  const [status, setStatus] = useState<ProjectStatusResponse | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [metrics, setMetrics] = useState<ContextOsMetrics | null>(null);
  const [tokenSavings, setTokenSavings] = useState<TokenSavingsStats | null>(null);
  const [config, setConfig] = useState<ProjectMemoryConfig | null>(null);
  const [connections, setConnections] = useState<AgentConnectionStatus[]>([]);
  const [serviceRunning, setServiceRunning] = useState<boolean | null>(null);
  const [lastCheckpoint, setLastCheckpoint] = useState<TaskCheckpoint | null>(null);
  const [lastPacket, setLastPacket] = useState<ContextPacket | null>(null);
  const [packetExplanation, setPacketExplanation] = useState<ContextExplanation | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceRoot) {
      setHello(null);
      setAvailableCapabilities(new Set());
      setStatus(null);
      setTasks([]);
      setMemories([]);
      setMetrics(null);
      setTokenSavings(null);
      setConfig(null);
      setConnections([]);
      setServiceRunning(null);
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      await memoryApi.bindWorkspace(workspaceRoot);
      const nextHello = await memoryApi.hello(workspaceRoot);
      const capabilities = negotiateMemoryCapabilities(
        nextHello.apiVersion,
        nextHello.capabilities,
      );
      if (!capabilities.compatible) {
        throw new Error(`Memory Engine is missing required capabilities: ${capabilities.missingCore.join(", ")}`);
      }

      const supports = (capability: string) => capabilities.available.has(capability);
      const [nextStatus, nextTasks, nextMemories, nextMetrics, nextSavings, nextConfig, nextService, nextConnections] = await Promise.all([
        memoryApi.status(workspaceRoot),
        supports("tasks.list") ? memoryApi.listTasks(workspaceRoot) : Promise.resolve({ items: [] }),
        memoryApi.list(workspaceRoot, { limit: 100 }),
        supports("usage.context_os") ? memoryApi.contextOsMetrics(workspaceRoot) : Promise.resolve(null),
        supports("usage.token_savings") ? memoryApi.tokenSavings(workspaceRoot) : Promise.resolve(null),
        supports("projects.config") ? memoryApi.config(workspaceRoot) : Promise.resolve(null),
        memoryApi.serviceStatus(),
        supports("agents.connections")
          ? memoryApi.agentConnections(workspaceRoot)
          : Promise.resolve({ items: [] as AgentConnectionStatus[] }),
      ]);
      setHello(nextHello);
      setAvailableCapabilities(capabilities.available);
      setStatus(nextStatus);
      setTasks(nextTasks.items);
      setMemories(nextMemories.items);
      setMetrics(nextMetrics);
      setTokenSavings(nextSavings);
      setConfig(nextConfig);
      setConnections(nextConnections.items);
      setServiceRunning(nextService.running);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setIsMutating(true);
    setError("");
    try {
      return await action();
    } catch (actionError) {
      setError(errorMessage(actionError));
      return null;
    } finally {
      setIsMutating(false);
    }
  }, []);

  const createTask = useCallback(async (input: CreateTaskInput) => {
    const created = await run(() => memoryApi.createTask(workspaceRoot, {
      title: input.title,
      objective: input.objective,
      phase: input.phase,
      priority: 500,
    }));
    if (created) await refresh();
    return created;
  }, [refresh, run, workspaceRoot]);

  const saveCheckpoint = useCallback(async (input: CheckpointInput) => {
    const checkpoint = await run(() => memoryApi.checkpointTask(workspaceRoot, {
      taskId: input.taskId,
      status: input.status,
      phase: input.phase,
      summary: input.summary,
      state: {
        changed: [],
        learned: [],
        decisionsAdded: [],
        constraintsAdded: [],
        failedAttempts: [],
        filesChanged: [],
        verification: [],
        unresolved: [],
        remaining: input.nextSteps,
      },
    }));
    if (checkpoint) {
      setLastCheckpoint(checkpoint);
      await refresh();
    }
    return checkpoint;
  }, [refresh, run, workspaceRoot]);

  const loadTaskActivity = useCallback(async (taskId: string): Promise<TaskActivity | null> => {
    return run(async () => {
      const [checkpoints, runs] = await Promise.all([
        availableCapabilities.has("tasks.checkpoints")
          ? memoryApi.listTaskCheckpoints(workspaceRoot, taskId)
          : Promise.resolve({ items: [] as TaskCheckpoint[] }),
        availableCapabilities.has("tasks.runs")
          ? memoryApi.listTaskRuns(workspaceRoot, taskId)
          : Promise.resolve({ items: [] as ExecutionRun[] }),
      ]);
      return { checkpoints: checkpoints.items, runs: runs.items };
    });
  }, [availableCapabilities, run, workspaceRoot]);

  const inspectTaskRun = useCallback(async (
    taskId: string,
    runId: string,
  ): Promise<TaskRunInspection | null> => {
    if (!availableCapabilities.has("tasks.run_context")) return null;
    return run(async () => {
      const context = await memoryApi.getTaskRunContext(workspaceRoot, taskId, runId);
      const explanation = context.packet
        ? await memoryApi.explainContextPacket(workspaceRoot, context.packet.id)
        : null;
      return { context, explanation };
    });
  }, [availableCapabilities, run, workspaceRoot]);

  const inspectPacket = useCallback(async (input: {
    currentRequest: string;
    taskId?: string;
    maxTokens?: number;
  }) => {
    const packet = await run(() => memoryApi.buildContextPacket(workspaceRoot, input));
    if (packet) {
      setLastPacket(packet);
      setPacketExplanation(null);
      const explanation = await run(() => memoryApi.explainContextPacket(workspaceRoot, packet.id));
      if (explanation) setPacketExplanation(explanation);
      await refresh();
    }
    return packet;
  }, [refresh, run, workspaceRoot]);

  const loadMemory = useCallback(async (memoryId: string) => (
    run(() => memoryApi.get(workspaceRoot, memoryId))
  ), [run, workspaceRoot]);

  const verifyMemory = useCallback(async (
    memoryId: string,
    state: "VERIFIED" | "DISPUTED",
    reason: string,
  ) => {
    const memory = await run(() => memoryApi.verify(workspaceRoot, memoryId, state, reason));
    if (memory) await refresh();
    return memory;
  }, [refresh, run, workspaceRoot]);

  const updateMemory = useCallback(async (
    memoryId: string,
    summary: string,
    content: string,
    reason: string,
  ) => {
    const memory = await run(() => memoryApi.update(workspaceRoot, memoryId, summary, content, reason));
    if (memory) await refresh();
    return memory;
  }, [refresh, run, workspaceRoot]);

  const archiveMemory = useCallback(async (memoryId: string, reason: string) => {
    const memory = await run(() => memoryApi.archive(workspaceRoot, memoryId, reason));
    if (memory) await refresh();
    return memory;
  }, [refresh, run, workspaceRoot]);

  const relateMemory = useCallback(async (
    memoryId: string,
    targetMemoryId: string,
    relation: MemoryRelationType,
    reason: string,
  ) => {
    const result = await run(() => memoryApi.relate(
      workspaceRoot,
      memoryId,
      targetMemoryId,
      relation,
      reason,
    ));
    if (result) await refresh();
    return result;
  }, [refresh, run, workspaceRoot]);

  const updateConfig = useCallback(async (captureMode: ProjectMemoryConfig["captureMode"], retentionDays: number) => {
    const nextConfig = await run(() => memoryApi.updateConfig(workspaceRoot, captureMode, retentionDays));
    if (nextConfig) setConfig(nextConfig);
    return nextConfig;
  }, [run, workspaceRoot]);

  const setService = useCallback(async (running: boolean) => {
    const completed = running
      ? await run(() => memoryApi.startService())
      : await run(() => memoryApi.stopService(workspaceRoot));
    if (completed) {
      setServiceRunning(running);
      if (running) await refresh();
    }
    return completed;
  }, [refresh, run, workspaceRoot]);

  return {
    archiveMemory,
    connections,
    config,
    createTask,
    error,
    hello,
    inspectPacket,
    inspectTaskRun,
    isLoading,
    isMutating,
    lastCheckpoint,
    lastPacket,
    loadMemory,
    loadTaskActivity,
    memories,
    metrics,
    packetExplanation,
    refresh,
    relateMemory,
    saveCheckpoint,
    serviceRunning,
    setService,
    status,
    tasks,
    tokenSavings,
    updateMemory,
    updateConfig,
    verifyMemory,
  };
}
