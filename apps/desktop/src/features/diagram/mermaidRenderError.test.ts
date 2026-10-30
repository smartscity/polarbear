import { expect, it, vi } from "vitest";
import { MermaidRenderError, wrapMermaidRenderError, describeMermaidRenderError } from "./mermaidRenderError";

it("preserves parser causes without inventing a source location after Mermaid preprocessing", () => {
  const cause = Object.assign(new Error("Parse error"), { hash: { line: 2 } });
  const wrapped = wrapMermaidRenderError(cause);
  expect(wrapped).toMatchObject({ kind: "syntax", cause });
  expect(wrapped.line).toBeUndefined();
});
it("reports unexpected engine errors locally and retains the original cause", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const cause = new TypeError("Engine defect");
    expect(wrapMermaidRenderError(cause)).toMatchObject({ kind: "render", cause });
    expect(spy).toHaveBeenCalledWith("Mermaid rendering failed", cause);
  } finally { spy.mockRestore(); }
});
it("shows the known source line without exposing browser exception text", () => {
  const failure = new MermaidRenderError("date", 15, "Internal detail");
  const translate = (key: string, values?: Record<string, string | number>) => key + (values ? ` ${values.line}` : "");
  expect(describeMermaidRenderError(failure, translate)).toBe("diagram.mermaidError.date diagram.mermaidError.line 15");
});
