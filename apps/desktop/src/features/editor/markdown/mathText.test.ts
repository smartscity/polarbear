import { describe, expect, it } from "vitest";
import { renderMathText } from "./mathText";

describe("renderMathText", () => {
  it("renders supported operators and Greek symbols", () => {
    expect(renderMathText("\\alpha \\times \\beta \\geq \\epsilon")).toBe(
      "α × β ≥ ε",
    );
  });

  it("keeps compact numeric subscripts readable", () => {
    expect(renderMathText("x_12 + y_0")).toBe("x₁₂ + y₀");
  });

  it("removes lightweight LaTex grouping without changing spacing", () => {
    expect(renderMathText("  {A}   \\neq  {B}  ")).toBe("A ≠ B");
  });
});
