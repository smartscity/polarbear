import { DIAGRAM_CONFIG } from "./diagramConfig";
import { plantUmlSvgUrl } from "./plantUmlUrl";
import { sanitizeDiagramSvg } from "./sanitizeDiagramSvg";

export type PlantUmlRenderFailureKind =
  | "httpStatus"
  | "invalidSvg"
  | "timeout";

export class PlantUmlRenderError extends Error {
  constructor(
    readonly kind: PlantUmlRenderFailureKind,
    readonly status?: number,
  ) {
    super(kind);
    this.name = "PlantUmlRenderError";
  }
}

type PlantUmlRenderOptions = {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Loads and sanitizes a remotely rendered PlantUML SVG. The caller remains
 * responsible for obtaining the user's explicit consent before invoking it.
 */
export async function renderPlantUmlSvg(
  source: string,
  options: PlantUmlRenderOptions = {},
): Promise<string> {
  const abortController = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => abortController.abort();
  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, options.timeoutMs ?? DIAGRAM_CONFIG.plantUml.renderTimeoutMs);

  try {
    const response = await (options.fetcher ?? fetch)(
      plantUmlSvgUrl(DIAGRAM_CONFIG.plantUml.serverUrl, source),
      { signal: abortController.signal },
    );
    if (!response.ok) {
      throw new PlantUmlRenderError("httpStatus", response.status);
    }

    const svgContent = await response.text();
    if (!svgContent.includes("<svg")) {
      throw new PlantUmlRenderError("invalidSvg");
    }

    return sanitizeDiagramSvg(svgContent);
  } catch (error) {
    if (timedOut) {
      throw new PlantUmlRenderError("timeout");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
