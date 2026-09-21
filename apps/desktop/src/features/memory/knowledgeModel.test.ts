import { describe, expect, it } from "vitest";
import type { KnowledgeSearchResponse } from "./generated/adminV1";
import {
  captureReadiness,
  KnowledgeSearchRequestGate,
  mergeKnowledgeHits,
  mergeKnowledgeSearchResponses,
  missingLongMemoryCapabilities,
  selectedEvidenceMatches,
} from "./knowledgeModel";

const documentContext = {
  fileId: "docs/retry.md",
  workspaceRoot: "/repo",
  relativePath: "docs/retry.md",
  editorRevision: "editor-r1",
  dirty: false,
  selection: {
    from: 9,
    to: 28,
    startLine: 3,
    endLine: 3,
    text: "Never retry FAILED.",
  },
};

describe("Long Memory UI model", () => {
  it("withholds a late response after a newer search starts", () => {
    const requests = new KnowledgeSearchRequestGate();
    const first = requests.start();
    const second = requests.start();

    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
  });

  it("makes loaded results stale as soon as the search input changes", () => {
    const requests = new KnowledgeSearchRequestGate();
    const loaded = requests.start();
    expect(requests.isCurrent(loaded)).toBe(true);

    requests.invalidate();

    expect(requests.isCurrent(loaded)).toBe(false);
  });

  it("negotiates the complete M1 capability slice", () => {
    expect(missingLongMemoryCapabilities([
      "projects.context",
      "sources.register",
      "sources.resolve",
      "knowledge.capture",
      "knowledge.search",
    ])).toEqual(["knowledge.review"]);
  });

  it("requires a saved selection and explicit task ownership", () => {
    const base = {
      documentContext,
      ownerKind: "TASK" as const,
      taskId: "task-a",
      answer: "Do not retry.",
      appliesWhen: "FAILED settlement",
      reason: "It can submit twice.",
    };
    expect(captureReadiness(base)).toBe("READY");
    expect(captureReadiness({ ...base, taskId: "" })).toBe("TASK_REQUIRED");
    expect(captureReadiness({
      ...base,
      documentContext: { ...documentContext, dirty: true },
    })).toBe("DIRTY_DOCUMENT");
    expect(captureReadiness({
      ...base,
      documentContext: { ...documentContext, selection: undefined },
    })).toBe("NO_SELECTION");
  });

  it("accepts only an exact, complete, unredacted evidence match", () => {
    const selection = documentContext.selection;
    const section = {
      locator: { startLine: 3, endLine: 3, startOffset: 9, endOffset: 28 },
      excerpt: "Never retry FAILED.",
      redacted: false,
      truncated: false,
    };
    expect(selectedEvidenceMatches({ selection, section })).toBe(true);
    expect(selectedEvidenceMatches({ selection, section: { ...section, excerpt: "Retry FAILED." } })).toBe(false);
    expect(selectedEvidenceMatches({
      selection,
      section: {
        ...section,
        locator: { startLine: 1, endLine: 4 },
        excerpt: "# Retry\n\nNever retry FAILED.\nManual review only.",
      },
    })).toBe(false);
    expect(selectedEvidenceMatches({ selection, section: { ...section, redacted: true } })).toBe(false);
  });

  it("deduplicates pages by card and keeps the newest revision", () => {
    const old = { card: { id: "card-a", revision: 1 }, rank: 1 };
    const current = { card: { id: "card-a", revision: 2 }, rank: 2 };
    const other = { card: { id: "card-b", revision: 1 }, rank: 3 };
    expect(mergeKnowledgeHits([old], [current, other])).toEqual([current, other]);
  });

  it("merges paged results without losing safety exclusions", () => {
    const first = {
      items: [{ card: { id: "card-a", revision: 1 }, decision: "REUSABLE" as const, reasonCodes: [], rank: 1 }],
      reviewNotices: [],
      excludedCounts: { INAPPLICABLE: 2 },
      partial: false,
      nextCursor: "page-2",
    } as unknown as KnowledgeSearchResponse;
    const second = {
      items: [{ card: { id: "card-b", revision: 1 }, decision: "REUSABLE" as const, reasonCodes: [], rank: 21 }],
      reviewNotices: [],
      excludedCounts: { INAPPLICABLE: 1, NEEDS_REVIEW: 1 },
      partial: true,
    } as unknown as KnowledgeSearchResponse;
    expect(mergeKnowledgeSearchResponses(first, second)).toMatchObject({
      items: [first.items[0], second.items[0]],
      excludedCounts: { INAPPLICABLE: 3, NEEDS_REVIEW: 1 },
      partial: true,
    });
    expect(mergeKnowledgeSearchResponses(first, second).nextCursor).toBeUndefined();
  });
});
