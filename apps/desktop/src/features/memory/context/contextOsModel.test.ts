import { describe, expect, it } from "vitest";
import type { MemoryRecord, TaskRecord } from "../generated/adminV1";
import {
  activeTaskFor,
  contextOverviewData,
  isStale,
  matchesMemoryStatus,
  needsAttention,
  tokenImpact,
} from "./contextOsModel";

function task(status: TaskRecord["status"], id: string): TaskRecord {
  return {
    id,
    projectId: "project",
    title: id,
    objective: id,
    status,
    phase: "IMPLEMENTATION",
    priority: 500,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
}

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
  it("prioritizes active durable work for the overview", () => {
    expect(activeTaskFor([
      task("PLANNED", "planned"),
      task("ACTIVE", "active"),
      task("BLOCKED", "blocked"),
    ])?.id).toBe("active");
  });

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
    expect(matchesMemoryStatus(stale, "stale")).toBe(true);
  });

  it("counts only concrete relationship signals in overview health", () => {
    const overview = contextOverviewData(
      [task("ACTIVE", "active")],
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

  it("reports savings and increased token impact without negative percentages", () => {
    expect(tokenImpact(1_000, 820)).toEqual({ kind: "savings", ratio: 0.18 });
    expect(tokenImpact(1_000, 1_100)).toEqual({ kind: "impact", ratio: 0.1 });
    expect(tokenImpact(0, 0)).toBeNull();
  });
});
