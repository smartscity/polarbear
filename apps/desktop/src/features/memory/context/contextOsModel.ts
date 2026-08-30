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
  | "needsReview"
  | "stale"
  | "superseded";

export type ContextOverviewData = {
  activeTask: TaskRecord | undefined;
  memoryCount: number;
  needsReviewCount: number;
  conflictCount: number;
  metrics: ContextOsMetrics | null;
};

export function activeTaskFor(tasks: readonly TaskRecord[]): TaskRecord | undefined {
  return tasks.find((task) => task.status === "ACTIVE")
    ?? tasks.find((task) => task.status === "VERIFYING")
    ?? tasks.find((task) => task.status === "BLOCKED")
    ?? tasks[0];
}

export function needsReview(memory: MemoryRecord): boolean {
  return memory.verificationState === "UNVERIFIED"
    || memory.verificationState === "DISPUTED"
    || memory.correctnessRisk === "HIGH";
}

export function isStale(memory: MemoryRecord): boolean {
  return memory.latestAssessment?.reasonCodes.some((code) =>
    code === "STALE" || code === "STALE_ANCHOR" || code === "BROKEN_ANCHOR",
  ) ?? false;
}

export function matchesMemoryStatus(
  memory: MemoryRecord,
  filter: MemoryStatusFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "active") return memory.lifecycleStatus === "ACTIVE";
  if (filter === "needsReview") return needsReview(memory);
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
    needsReviewCount: memories.filter(needsReview).length,
    conflictCount: memories.reduce(
      (count, memory) => count + memory.relations.filter((relation) => relation.type === "CONTRADICTS").length,
      0,
    ),
    metrics,
  };
}
