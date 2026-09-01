import { describe, expect, it } from "vitest";
import type { MemoryRecord } from "../generated/adminV1";
import {
  contextOverviewData,
  isStale,
  memoryDisplayState,
  matchesMemoryStatus,
  needsAttention,
  summarizeContextSources,
  tokenImpact,
} from "./contextOsModel";

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "MEM-1",
    projectId: "project",
    type: "FACT",
    summary: "A durable fact",
    content: "Memory content",
    lifecycleStatus: "ACTIVE",
    verificationState: "VERIFIED",
    correctnessRisk: "LOW",
    relevance: 1,
    completionState: "OPEN",
    confidence: 1,
    importance: 1,
    sourceType: "CLI",
    files: [],
    fileAnchors: [],
    relations: [],
    usage: {
      candidateCount: 0,
      selectedCount: 0,
      positiveFeedbackCount: 0,
      negativeFeedbackCount: 0,
    },
    revisionCount: 1,
    evidence: [],
    entities: [],
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("Context OS lean model", () => {
  it("only surfaces exceptional active memories as needing attention", () => {
    const normal = memory({ verificationState: "UNVERIFIED", importance: 500, confidence: 500 });
    const importantLowConfidence = memory({ verificationState: "UNVERIFIED", importance: 800, confidence: 500 });
    const stale = memory({
      latestAssessment: {
        previousRisk: "LOW",
        newRisk: "MEDIUM",
        previousLifecycle: "ACTIVE",
        newLifecycle: "ACTIVE",
        relevance: 0.5,
        reasonCodes: ["STALE_ANCHOR"],
        policyVersion: "1",
        assessorVersion: "1",
        assessedAt: "2026-08-29T00:00:00.000Z",
      },
    });

    expect(needsAttention(normal)).toBe(false);
    expect(needsAttention(importantLowConfidence)).toBe(true);
    expect(matchesMemoryStatus(importantLowConfidence, "needsAttention")).toBe(true);
    expect(isStale(stale)).toBe(true);
    expect(memoryDisplayState(stale)).toBe("active");
  });

  it("counts only concrete relationship signals in overview health", () => {
    const overview = contextOverviewData(
      [memory({
        verificationState: "UNVERIFIED",
        relations: [{
          sourceMemoryId: "MEM-1",
          targetMemoryId: "MEM-2",
          type: "CONTRADICTS",
          reason: "Conflicting evidence",
          createdAt: "2026-08-29T00:00:00.000Z",
        }],
      })],
      null,
    );

    expect(overview.needsAttentionCount).toBe(1);
    expect(overview.conflictCount).toBe(1);
  });

  it("maps rejected Memory into history and groups Context sources", () => {
    const rejected = memory({ lifecycleStatus: "REJECTED", verificationState: "DISPUTED" });
    expect(memoryDisplayState(rejected)).toBe("rejected");
    expect(matchesMemoryStatus(rejected, "archived")).toBe(true);
    expect(summarizeContextSources({ items: [
      { category: "DECISIONS", estimatedTokens: 120 },
      { category: "DECISIONS", estimatedTokens: 80 },
      { category: "ARCHITECTURE", estimatedTokens: 140 },
    ] })).toEqual([
      { category: "DECISIONS", tokens: 200, count: 2 },
      { category: "ARCHITECTURE", tokens: 140, count: 1 },
    ]);
  });

  it("reports savings and increased token impact without negative percentages", () => {
    expect(tokenImpact(1_000, 820)).toEqual({ kind: "savings", ratio: 0.18 });
    expect(tokenImpact(1_000, 1_100)).toEqual({ kind: "impact", ratio: 0.1 });
    expect(tokenImpact(0, 0)).toBeNull();
  });
});
