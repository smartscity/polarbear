import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../../shared/tauri/invokeTauri";
import type {
  AgentIntegrationStatus,
  ContextExplanation,
  ContextOsMetrics,
  ContextPacket,
  DiagnosticsResponse,
  HelloResponse,
  MemoryHistoryResponse,
  MemoryRecord,
  ProjectMemoryConfig,
  ProjectStatusResponse,
  TokenSavingsStats,
} from "../generated/adminV1";
import { negotiateMemoryCapabilities } from "../memoryCapabilities";
import { memoryApi } from "../memoryApi";

export function useContextOsSession(workspaceRoot: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState("");
  const [hello, setHello] = useState<HelloResponse | null>(null);
  const [status, setStatus] = useState<ProjectStatusResponse | null>(null);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [metrics, setMetrics] = useState<ContextOsMetrics | null>(null);
  const [tokenSavings, setTokenSavings] = useState<TokenSavingsStats | null>(null);
  const [config, setConfig] = useState<ProjectMemoryConfig | null>(null);
  const [integrations, setIntegrations] = useState<AgentIntegrationStatus[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [lastPacket, setLastPacket] = useState<ContextPacket | null>(null);
  const [packetExplanation, setPacketExplanation] = useState<ContextExplanation | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceRoot) {
      setHello(null);
      setStatus(null);
      setMemories([]);
      setMetrics(null);
      setTokenSavings(null);
      setConfig(null);
      setIntegrations([]);
      setDiagnostics(null);
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
      const [nextStatus, nextMemories, nextMetrics, nextSavings, nextConfig, nextContext] = await Promise.all([
        memoryApi.status(workspaceRoot),
        memoryApi.list(workspaceRoot, { limit: 100 }),
        supports("usage.context_os") ? memoryApi.contextOsMetrics(workspaceRoot) : Promise.resolve(null),
        supports("usage.token_savings") ? memoryApi.tokenSavings(workspaceRoot) : Promise.resolve(null),
        supports("projects.config") ? memoryApi.config(workspaceRoot) : Promise.resolve(null),
        supports("contexts.current")
          ? memoryApi.currentContextPacket(workspaceRoot)
          : Promise.resolve({ packet: null }),
      ]);
      setHello(nextHello);
      setStatus(nextStatus);
      setMemories(nextMemories.items);
      setMetrics(nextMetrics);
      setTokenSavings(nextSavings);
      setConfig(nextConfig);
      setLastPacket(nextContext.packet);
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

  const verifyMemory = useCallback(async (
    memoryId: string,
    state: "VERIFIED" | "DISPUTED",
    reason: string,
  ) => {
    const memory = await run(() => memoryApi.verify(workspaceRoot, memoryId, state, reason));
    if (memory) await refresh();
    return memory;
  }, [refresh, run, workspaceRoot]);

  const rejectMemory = useCallback(async (memoryId: string, reason: string) => {
    const memory = await run(() => memoryApi.reject(workspaceRoot, memoryId, reason));
    if (memory) await refresh();
    return memory;
  }, [refresh, run, workspaceRoot]);

  const loadMemoryHistory = useCallback(async (memoryId: string): Promise<MemoryHistoryResponse | null> => (
    run(() => memoryApi.history(workspaceRoot, memoryId))
  ), [run, workspaceRoot]);

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

  const updateConfig = useCallback(async (next: ProjectMemoryConfig) => {
    const nextConfig = await run(() => memoryApi.updateConfig(workspaceRoot, next));
    if (nextConfig) setConfig(nextConfig);
    return nextConfig;
  }, [run, workspaceRoot]);

  const repairIntegration = useCallback(async (integration: AgentIntegrationStatus["id"]) => {
    const result = await run(() => memoryApi.repairAgentIntegration(workspaceRoot, integration));
    if (result) setIntegrations(result.items);
    return result;
  }, [run, workspaceRoot]);

  const refreshIntegrations = useCallback(async () => {
    if (!hello?.capabilities.includes("agents.integrations")) return null;
    const result = await run(() => memoryApi.agentIntegrations(workspaceRoot));
    if (result) setIntegrations(result.items);
    return result;
  }, [hello, run, workspaceRoot]);

  const runDiagnostics = useCallback(async () => {
    const result = await run(() => memoryApi.diagnostics(workspaceRoot));
    if (result) setDiagnostics(result);
    return result;
  }, [run, workspaceRoot]);

  return {
    archiveMemory,
    config,
    diagnostics,
    error,
    hello,
    inspectPacket,
    integrations,
    isLoading,
    isMutating,
    lastPacket,
    loadMemoryHistory,
    memories,
    metrics,
    packetExplanation,
    refresh,
    refreshIntegrations,
    rejectMemory,
    repairIntegration,
    runDiagnostics,
    status,
    tokenSavings,
    updateMemory,
    updateConfig,
    verifyMemory,
  };
}
