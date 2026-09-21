import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../../shared/tauri/invokeTauri";
import type {
  AgentIntegrationStatus,
  ContextExplanation,
  ContextReceipt,
  ContextOsMetrics,
  ContextPacket,
  DiagnosticsResponse,
  HelloResponse,
  KnowledgeCard,
  KnowledgeSearchHit,
  KnowledgeSearchResponse,
  MemoryHistoryResponse,
  MemoryRecord,
  ProjectMemoryConfig,
  ProjectStatusResponse,
  ProjectWorkContext,
  MemoryType,
  SourceResolution,
  TaskRecord,
  TokenSavingsStats,
} from "../generated/adminV1";
import { negotiateMemoryCapabilities } from "../memoryCapabilities";
import { memoryApi } from "../memoryApi";
import type { MemoryDocumentContext } from "../documentContext";
import {
  KnowledgeSearchRequestGate,
  LONG_MEMORY_CAPABILITIES,
  mergeKnowledgeSearchResponses,
  selectedEvidenceMatches,
} from "../knowledgeModel";

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
  const [contextReceipt, setContextReceipt] = useState<ContextReceipt | null>(null);
  const [safeToReplaceSession, setSafeToReplaceSession] = useState(false);
  const [activeTaskTitle, setActiveTaskTitle] = useState("");
  const [latestCheckpointId, setLatestCheckpointId] = useState("");
  const [packetExplanation, setPacketExplanation] = useState<ContextExplanation | null>(null);
  const [workContext, setWorkContext] = useState<ProjectWorkContext | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [knowledgeSearch, setKnowledgeSearch] = useState<KnowledgeSearchResponse | null>(null);
  const [longMemoryAvailable, setLongMemoryAvailable] = useState(false);
  const searchRequestGateRef = useRef(new KnowledgeSearchRequestGate());

  const refresh = useCallback(async () => {
    searchRequestGateRef.current.invalidate();
    setKnowledgeSearch(null);
    if (!workspaceRoot) {
      setHello(null);
      setStatus(null);
      setMemories([]);
      setMetrics(null);
      setTokenSavings(null);
      setConfig(null);
      setIntegrations([]);
      setDiagnostics(null);
      setContextReceipt(null);
      setSafeToReplaceSession(false);
      setActiveTaskTitle("");
      setLatestCheckpointId("");
      setWorkContext(null);
      setTasks([]);
      setKnowledgeSearch(null);
      setLongMemoryAvailable(false);
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
      const supportsLongMemory = LONG_MEMORY_CAPABILITIES.every((capability) => supports(capability));
      const [nextStatus, nextMemories, nextMetrics, nextSavings, nextConfig, nextContext, nextWorkContext, nextTasks] = await Promise.all([
        memoryApi.status(workspaceRoot),
        memoryApi.list(workspaceRoot, { limit: 100 }),
        supports("usage.context_os") ? memoryApi.contextOsMetrics(workspaceRoot) : Promise.resolve(null),
        supports("usage.token_savings") ? memoryApi.tokenSavings(workspaceRoot) : Promise.resolve(null),
        supports("projects.config") ? memoryApi.config(workspaceRoot) : Promise.resolve(null),
        supports("contexts.current")
          ? memoryApi.currentContextPacket(workspaceRoot)
          : Promise.resolve({
              packet: null, receipt: null, task: null, latestCheckpoint: null, safeToReplaceSession: false,
            }),
        supportsLongMemory ? memoryApi.projectContext(workspaceRoot) : Promise.resolve(null),
        supports("tasks.list") ? memoryApi.listTasks(workspaceRoot) : Promise.resolve({ items: [] }),
      ]);
      setHello(nextHello);
      setStatus(nextStatus);
      setMemories(nextMemories.items);
      setMetrics(nextMetrics);
      setTokenSavings(nextSavings);
      setConfig(nextConfig);
      setLastPacket(nextContext.packet);
      setContextReceipt(nextContext.receipt ?? null);
      setSafeToReplaceSession(nextContext.safeToReplaceSession ?? false);
      setActiveTaskTitle(nextContext.task?.title ?? "");
      setLatestCheckpointId(nextContext.latestCheckpoint?.id ?? "");
      setWorkContext(nextWorkContext);
      setTasks(nextTasks.items);
      setLongMemoryAvailable(supportsLongMemory);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    setWorkContext(null);
    setTasks([]);
    setKnowledgeSearch(null);
    setLongMemoryAvailable(false);
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

  const captureKnowledge = useCallback(async (input: {
    documentContext: MemoryDocumentContext;
    ownerKind: "PROJECT" | "TASK";
    taskId?: string;
    kind: MemoryType;
    answer: string;
    appliesWhen: string;
    reason: string;
    workingCopyPolicy: "CAPTURED_CONTEXT" | "COMPATIBLE_SOURCES";
    requestIds: { register: string; capture: string };
  }): Promise<KnowledgeCard | null> => {
    const selection = input.documentContext.selection;
    if (!workContext || !selection) return null;
    const card = await run(async () => {
      const registered = await memoryApi.registerSource(workspaceRoot, {
        worktreeId: workContext.worktreeId,
        relativePath: input.documentContext.relativePath,
        startLine: selection.startLine,
        endLine: selection.endLine,
        startOffset: selection.from,
        endOffset: selection.to,
        selectedText: selection.text,
        requestId: input.requestIds.register,
      });
      if (!registered.approvedSection || !registered.observedRevision
        || !selectedEvidenceMatches({ selection, section: registered.approvedSection })) {
        throw new Error("The saved source no longer matches the selected evidence.");
      }
      return memoryApi.captureKnowledge(workspaceRoot, {
        ownerKind: input.ownerKind,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        kind: input.kind,
        answer: input.answer,
        appliesWhen: input.appliesWhen,
        reason: input.reason,
        workingCopyPolicy: input.workingCopyPolicy,
        sourceId: registered.source.id,
        sourceRevision: registered.observedRevision,
        sectionDigest: registered.approvedSection.sectionDigest,
        validationDigest: registered.approvedSection.validationDigest,
        ...registered.approvedSection.locator,
        requestId: input.requestIds.capture,
      });
    });
    if (card) await refresh();
    return card;
  }, [refresh, run, workContext, workspaceRoot]);

  const searchKnowledge = useCallback(async (input: {
    query: string;
    taskId?: string;
    cursor?: string;
  }): Promise<KnowledgeSearchResponse | null> => {
    const requestSequence = searchRequestGateRef.current.start();
    if (!input.cursor) setKnowledgeSearch(null);
    const result = await run(() => memoryApi.searchKnowledge(workspaceRoot, {
      query: input.query,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      limit: 20,
    }));
    if (result && searchRequestGateRef.current.isCurrent(requestSequence)) {
      setKnowledgeSearch((current) => input.cursor && current
        ? mergeKnowledgeSearchResponses(current, result)
        : result);
    }
    return searchRequestGateRef.current.isCurrent(requestSequence) ? result : null;
  }, [run, workspaceRoot]);

  const resolveKnowledgeSource = useCallback(async (
    hit: KnowledgeSearchHit,
    taskId?: string,
  ): Promise<SourceResolution | null> => run(() => memoryApi.resolveSource(workspaceRoot, {
    cardId: hit.card.id,
    expectedCardRevision: hit.card.revision,
    ...(taskId ? { taskId } : {}),
  })), [run, workspaceRoot]);

  const reviewKnowledge = useCallback(async (input: {
    hit: KnowledgeSearchHit;
    answer: string;
    appliesWhen: string;
    reason: string;
    taskId?: string;
    workingCopyPolicy: "CAPTURED_CONTEXT" | "COMPATIBLE_SOURCES";
    requestId: string;
  }): Promise<KnowledgeCard | null> => {
    const evidence = input.hit.evidence;
    if (!evidence?.observedRevision || !evidence.observedSection) return null;
    const reviewed = await run(() => memoryApi.reviewKnowledge(workspaceRoot, {
      cardId: input.hit.card.id,
      expectedRevision: input.hit.card.revision,
      expectedSourceVersion: evidence.source.version,
      expectedObservedRevision: evidence.observedRevision!,
      answer: input.answer,
      appliesWhen: input.appliesWhen,
      reason: input.reason,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      workingCopyPolicy: input.workingCopyPolicy,
      ...evidence.observedSection!.locator,
      requestId: input.requestId,
    }));
    if (reviewed) await refresh();
    return reviewed;
  }, [refresh, run, workspaceRoot]);

  return {
    archiveMemory,
    config,
    contextReceipt,
    diagnostics,
    error,
    hello,
    inspectPacket,
    integrations,
    isLoading,
    isMutating,
    lastPacket,
    activeTaskTitle,
    captureKnowledge,
    latestCheckpointId,
    knowledgeSearch,
    clearKnowledgeSearch: () => {
      searchRequestGateRef.current.invalidate();
      setKnowledgeSearch(null);
    },
    longMemoryAvailable,
    loadMemoryHistory,
    memories,
    metrics,
    packetExplanation,
    refresh,
    refreshIntegrations,
    resolveKnowledgeSource,
    rejectMemory,
    repairIntegration,
    runDiagnostics,
    searchKnowledge,
    status,
    safeToReplaceSession,
    tokenSavings,
    tasks,
    updateMemory,
    updateConfig,
    verifyMemory,
    reviewKnowledge,
    workContext,
  };
}
