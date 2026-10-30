import type { Translate } from "../../shared/i18n/translate";

export type MermaidFailureKind = "syntax" | "date" | "dependency" | "calendar" | "limit" | "render";

/** Source locations are one-based lines in the original Mermaid block, when known. */
export class MermaidRenderError extends Error {
  constructor(
    readonly kind: MermaidFailureKind,
    readonly line?: number,
    readonly detail = "",
    options?: ErrorOptions,
  ) {
    super(`Mermaid ${kind} error${line ? ` at line ${line}` : ""}: ${detail}`, options);
    this.name = "MermaidRenderError";
  }
}

export function describeMermaidRenderError(error: unknown, t: Translate): string {
  const failure = error instanceof MermaidRenderError ? error : new MermaidRenderError("render");
  return t(`diagram.mermaidError.${failure.kind}`)
    + (failure.line ? ` ${t("diagram.mermaidError.line", { line: failure.line })}` : "");
}

export function wrapMermaidRenderError(error: unknown): MermaidRenderError {
  if (error instanceof MermaidRenderError) return error;
  // Jison exposes a structured hash. Do not infer positions from browser-specific messages.
  if (typeof error === "object" && error !== null && "hash" in error) {
    return new MermaidRenderError("syntax", undefined, "Mermaid parser rejected the source", { cause: error });
  }
  // Preserve unexpected engine/program errors for local diagnostics instead of calling them bad input.
  console.error("Mermaid rendering failed", error);
  return new MermaidRenderError("render", undefined, "Mermaid engine failed", { cause: error });
}
