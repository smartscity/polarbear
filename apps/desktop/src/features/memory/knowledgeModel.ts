import type { MemoryDocumentContext } from "./documentContext";
import type { KnowledgeSearchResponse } from "./generated/adminV1";

export const LONG_MEMORY_CAPABILITIES = [
  "projects.context",
  "sources.register",
  "sources.resolve",
  "knowledge.capture",
  "knowledge.search",
  "knowledge.review",
] as const;

export type CaptureReadiness =
  | "READY"
  | "NO_DOCUMENT"
  | "DIRTY_DOCUMENT"
  | "NO_SELECTION"
  | "TASK_REQUIRED"
  | "INCOMPLETE_FIELDS";

/**
 * Allows only the newest knowledge search to publish results. Starting another
 * request or invalidating the current input makes every older token stale.
 */
export class KnowledgeSearchRequestGate {
  #generation = 0;

  start(): number {
    this.#generation += 1;
    return this.#generation;
  }

  invalidate(): void {
    this.#generation += 1;
  }

  isCurrent(generation: number): boolean {
    return generation === this.#generation;
  }
}

export function missingLongMemoryCapabilities(
  available: ReadonlySet<string> | readonly string[],
): string[] {
  const capabilities = available instanceof Set ? available : new Set(available);
  return LONG_MEMORY_CAPABILITIES.filter((capability) => !capabilities.has(capability));
}

export function captureReadiness(input: {
  documentContext: MemoryDocumentContext | null;
  ownerKind: "TASK" | "PROJECT";
  taskId: string;
  answer: string;
  appliesWhen: string;
  reason: string;
}): CaptureReadiness {
  if (!input.documentContext) return "NO_DOCUMENT";
  if (input.documentContext.dirty) return "DIRTY_DOCUMENT";
  if (!input.documentContext.selection?.text) return "NO_SELECTION";
  if (input.ownerKind === "TASK" && !input.taskId) return "TASK_REQUIRED";
  if (!input.answer.trim() || !input.appliesWhen.trim() || !input.reason.trim()) {
    return "INCOMPLETE_FIELDS";
  }
  return "READY";
}

export function selectedEvidenceMatches(input: {
  selection: NonNullable<MemoryDocumentContext["selection"]>;
  section: {
    locator: {
      startLine: number;
      endLine: number;
      startOffset?: number;
      endOffset?: number;
    };
    excerpt: string;
    redacted: boolean;
    truncated: boolean;
  };
}): boolean {
  if (input.section.redacted || input.section.truncated) return false;
  if (
    input.section.locator.startLine !== input.selection.startLine
    || input.section.locator.endLine !== input.selection.endLine
  ) {
    return false;
  }
  if (
    input.section.locator.startOffset !== undefined
    && input.section.locator.startOffset !== input.selection.from
  ) {
    return false;
  }
  if (
    input.section.locator.endOffset !== undefined
    && input.section.locator.endOffset !== input.selection.to
  ) {
    return false;
  }
  return input.section.excerpt === input.selection.text;
}

export function mergeKnowledgeHits<T extends { card: { id: string; revision: number } }>(
  previous: readonly T[],
  next: readonly T[],
): T[] {
  const merged = new Map(previous.map((hit) => [hit.card.id, hit]));
  for (const hit of next) {
    const current = merged.get(hit.card.id);
    if (!current || hit.card.revision >= current.card.revision) {
      merged.set(hit.card.id, hit);
    }
  }
  return [...merged.values()];
}

export function mergeKnowledgeSearchResponses(
  previous: KnowledgeSearchResponse,
  next: KnowledgeSearchResponse,
): KnowledgeSearchResponse {
  const excludedCounts = { ...previous.excludedCounts };
  for (const [decision, count] of Object.entries(next.excludedCounts)) {
    const key = decision as keyof typeof excludedCounts;
    excludedCounts[key] = (excludedCounts[key] ?? 0) + (count ?? 0);
  }
  return {
    items: mergeKnowledgeHits(previous.items, next.items),
    reviewNotices: mergeKnowledgeHits(previous.reviewNotices, next.reviewNotices),
    excludedCounts,
    partial: previous.partial || next.partial,
    ...(next.nextCursor ? { nextCursor: next.nextCursor } : {}),
  };
}
