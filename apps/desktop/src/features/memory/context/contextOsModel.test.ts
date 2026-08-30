import { describe, expect, it } from "vitest";
import type { MemoryRecord, TaskRecord } from "../generated/adminV1";
import {
  activeTaskFor,
  contextOverviewData,
  isStale,
  matchesMemoryStatus,
  needsReview,
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

  it("keeps review and stale concepts inside Memory filters", () => {
    const unverified = memory({ verificationState: "UNVERIFIED" });
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

    expect(needsReview(unverified)).toBe(true);
    expect(matchesMemoryStatus(unverified, "needsReview")).toBe(true);
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

    expect(overview.needsReviewCount).toBe(1);
    expect(overview.conflictCount).toBe(1);
  });
});
