import type { ContextOsMetrics, MemoryRecord, TaskRecord } from "../generated/adminV1";

export const CONTEXT_SECTIONS = [
  "overview",
  "memory",
  "tasks",
  "settings",
] as const;

export type ContextSection = (typeof CONTEXT_SECTIONS)[number];

export type MemoryStatusFilter =
  | "all"
  | "active"
  | "needsAttention"
  | "stale"
  | "superseded";

export type ContextOverviewData = {
  activeTask: TaskRecord | undefined;
  memoryCount: number;
  needsAttentionCount: number;
  conflictCount: number;
  metrics: ContextOsMetrics | null;
};

export function activeTaskFor(tasks: readonly TaskRecord[]): TaskRecord | undefined {
  return tasks.find((task) => task.status === "ACTIVE")
    ?? tasks.find((task) => task.status === "VERIFYING")
    ?? tasks.find((task) => task.status === "BLOCKED")
    ?? tasks[0];
}

const IMPORTANT_MEMORY_THRESHOLD = 700;
const LOW_CONFIDENCE_THRESHOLD = 600;

export function needsAttention(memory: MemoryRecord): boolean {
  if (memory.lifecycleStatus !== "ACTIVE") return false;
  if (memory.verificationState === "DISPUTED") return true;
  if (memory.verificationState === "VERIFIED") return false;
  const important = memory.importance >= IMPORTANT_MEMORY_THRESHOLD;
  const conflicts = memory.relations.some((relation) => relation.type === "CONTRADICTS");
  return conflicts
    || (important && memory.confidence < LOW_CONFIDENCE_THRESHOLD)
    || (important && (memory.correctnessRisk === "HIGH" || isStale(memory)));
}

export function isStale(memory: MemoryRecord): boolean {
  return memory.latestAssessment?.reasonCodes.some((code) =>
    code === "STALE"
      || code === "STALE_ANCHOR"
      || code === "BROKEN_ANCHOR"
      || code === "ANCHOR_FILE_MISSING"
      || code === "ANCHOR_UNREADABLE_OR_TOO_LARGE"
      || code === "ANCHOR_DIGEST_CHANGED",
  ) ?? false;
}

export function matchesMemoryStatus(
  memory: MemoryRecord,
  filter: MemoryStatusFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "active") return memory.lifecycleStatus === "ACTIVE";
  if (filter === "needsAttention") return needsAttention(memory);
  if (filter === "stale") return isStale(memory);
  return memory.lifecycleStatus === "SUPERSEDED";
}

export function contextOverviewData(
  tasks: readonly TaskRecord[],
  memories: readonly MemoryRecord[],
  metrics: ContextOsMetrics | null,
): ContextOverviewData {
  return {
    activeTask: activeTaskFor(tasks),
    memoryCount: memories.length,
    needsAttentionCount: memories.filter(needsAttention).length,
    conflictCount: memories.reduce(
      (count, memory) => count + memory.relations.filter((relation) => relation.type === "CONTRADICTS").length,
      0,
    ),
    metrics,
  };
}

export type TokenImpact = { kind: "savings" | "impact"; ratio: number };

export function tokenImpact(baselineTokens: number, contextTokens: number): TokenImpact | null {
  if (baselineTokens <= 0) return null;
  const difference = baselineTokens - contextTokens;
  return {
    kind: difference >= 0 ? "savings" : "impact",
    ratio: Math.abs(difference) / baselineTokens,
  };
}
