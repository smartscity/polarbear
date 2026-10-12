import { describe, expect, it } from "vitest";
import { captureSelection, readingTerm, readingText } from "./readingModel";

describe("mobile reading captures", () => {
  it("accepts English passages but rejects empty, oversized and control-character selections", () => {
    expect(readingText(" A resilient team.\nWorks well. ")).toBe("A resilient team.\nWorks well.");
    for (const input of ["", "中文", "a".repeat(2001), `abc${String.fromCharCode(0)}`]) expect(readingText(input)).toBeNull();
  });
  it("requires a word or phrase rather than silently saving a whole sentence", () => {
    expect(readingTerm(" look  after ")).toBe("look after");
    expect(readingTerm("It's a sentence.")).toBeNull();
    expect(readingTerm("a".repeat(81))).toBeNull();
  });
  it("uses the existing Vocab capture contract without sandbox paths or guessed dictionary senses", () => {
    const selection = { text: "resilient", sentence: "A resilient team.", title: "Reading.md", heading: "Teams" };
    const capture = captureSelection(selection, "resilient", true);
    expect(capture).toMatchObject({ selectedText: "resilient", sentence: selection.sentence, title: selection.title, heading: "Teams", senseUid: null, filePath: null, line: null });
    expect(capture.requestId).toMatch(/^[a-f\d-]{36}$/);
    expect(captureSelection(selection, "resilient", false)).toMatchObject({ sentence: "", title: "", heading: "" });
    expect(() => captureSelection(selection, "invalid!", true)).toThrow("invalidTerm");
  });
});
