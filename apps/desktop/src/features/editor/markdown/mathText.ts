const SUBSCRIPT_DIGITS: Readonly<Record<string, string>> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

function toSubscript(value: string): string {
  return value.replace(/[0-9]/g, (digit) => SUBSCRIPT_DIGITS[digit] ?? digit);
}

/**
 * Provides a readable fallback while the live editor renders lightweight
 * LaTeX previews without depending on a full math layout engine.
 */
export function renderMathText(source: string): string {
  return source
    .replace(/\\times/g, "×")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\in/g, "∈")
    .replace(/\\epsilon/g, "ε")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\delta/g, "δ")
    .replace(/\\_/g, "_")
    .replace(/([A-Za-z])_([0-9]+)/g, (_, name: string, digits: string) =>
      `${name}${toSubscript(digits)}`,
    )
    .replace(/\{([^{}]+)\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
