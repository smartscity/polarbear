import { expect, it } from "vitest";
import { readingPlainText, readingSourceTitle } from "./readingPresentation";

it("renders complete and clipped Markdown excerpts without changing stored provenance", () => {
  expect(readingPlainText("**Ultimately, growth matters.")).toBe("Ultimately, growth matters.");
  expect(readingPlainText("A **growth** [model](https://example.org) with `code`.")).toBe("A growth model with code.");
});

it("does not repeat an article heading beside its equivalent filename", () => {
  expect(readingSourceTitle("China's Property Market A Changing Economy.md", "China's Property Market: A Changing Economy"))
    .toBe("China's Property Market: A Changing Economy");
  expect(readingSourceTitle("Article.md", "Section")).toBe("Article · Section");
});
