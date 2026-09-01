import type { ContextOsMetrics, MemoryRecord } from "../generated/adminV1";

export const CONTEXT_SECTIONS = [
  "overview",
  "memory",
  "settings",
] as const;

export type ContextSection = (typeof CONTEXT_SECTIONS)[number];

export type MemoryStatusFilter =
  | "all"
  | "needsAttention"
  | "archived";

export type ContextOverviewData = {
  memoryCount: number;
  needsAttentionCount: number;
  conflictCount: number;
  metrics: ContextOsMetrics | null;
};

const IMPORTANT_MEMORY_THRESHOLD = 700;
const LOW_CONFIDENCE_THRESHOLD = 600;

export function needsAttention(memory: MemoryRecord): boolean {
  if (memory.lifecycleStatus !== "ACTIVE") return false;
  if (memory.verificationState === "DISPUTED") return true;
  if (memory.verificationState === "VERIFIED") return false;
  const important = memory.importance >= IMPORTANT_MEMORY_THRESHOLD;
  const conflicts = memory.relations.some((relation) => relation.type === "CONTRADICTS");
  return conflicts
    || memory.correctnessRisk === "HIGH"
    || (important && memory.confidence < LOW_CONFIDENCE_THRESHOLD)
    || (important && isStale(memory));
}

export function memoryDisplayState(memory: MemoryRecord): "active" | "needsAttention" | "rejected" | "archived" {
  if (memory.lifecycleStatus === "REJECTED") return "rejected";
  if (memory.lifecycleStatus === "ARCHIVED" || memory.lifecycleStatus === "SUPERSEDED") return "archived";
  return needsAttention(memory) ? "needsAttention" : "active";
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
  if (filter === "needsAttention") return needsAttention(memory);
  return memory.lifecycleStatus === "ARCHIVED"
    || memory.lifecycleStatus === "SUPERSEDED"
    || memory.lifecycleStatus === "REJECTED";
}

export type ContextSourceSummary = { category: string; tokens: number; count: number };

export function summarizeContextSources(packet: { items: Array<{ category: string; estimatedTokens: number }> } | null): ContextSourceSummary[] {
  if (!packet) return [];
  const summaries = new Map<string, ContextSourceSummary>();
  for (const item of packet.items) {
    const current = summaries.get(item.category) ?? { category: item.category, tokens: 0, count: 0 };
    current.tokens += item.estimatedTokens;
    current.count += 1;
    summaries.set(item.category, current);
  }
  return [...summaries.values()].sort((left, right) => right.tokens - left.tokens);
}

export function contextOverviewData(
  memories: readonly MemoryRecord[],
  metrics: ContextOsMetrics | null,
): ContextOverviewData {
  return {
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
