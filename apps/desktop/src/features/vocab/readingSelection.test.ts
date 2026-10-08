import { describe, expect, it } from "vitest";
import { normalizeReadingTerm, readingContext } from "./readingSelection";

describe("reading selection", () => {
  it("preserves phrases, casing, apostrophes and hyphens", () => {
    expect(normalizeReadingTerm("  Look   forward to ")).toBe("Look forward to");
    expect(normalizeReadingTerm("don't")).toBe("don't");
    expect(normalizeReadingTerm("well-known")).toBe("well-known");
  });
  it("rejects empty, non-English, code and overlong selections", () => {
    for (const value of ["", "你好", "foo()", "a".repeat(81)]) {
      expect(normalizeReadingTerm(value)).toBeNull();
    }
  });
  it("captures the sentence and source location without changing the document", () => {
    const text = "# Reading\nFirst sentence. We explore resilient systems. Next sentence.";
    const start = text.indexOf("resilient");
    expect(readingContext(text, start, start + 9)).toEqual({
      sentence: "We explore resilient systems.", heading: "Reading", line: 2,
    });
  });
  it("handles a final sentence without punctuation", () => {
    expect(readingContext("A lasting memory", 10, 16).sentence).toBe("A lasting memory");
  });
});
