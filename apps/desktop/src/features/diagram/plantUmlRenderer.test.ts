import { describe, expect, it, vi } from "vitest";

const { sanitizeDiagramSvgMock } = vi.hoisted(() => ({
  sanitizeDiagramSvgMock: vi.fn((svgContent: string) =>
    svgContent.replace(/<script[\s\S]*?<\/script>/gi, ""),
  ),
}));

vi.mock("./sanitizeDiagramSvg", () => ({
  sanitizeDiagramSvg: sanitizeDiagramSvgMock,
}));

import { renderPlantUmlSvg } from "./plantUmlRenderer";

describe("PlantUML renderer", () => {
  it("sanitizes a successful SVG response", async () => {
    const result = await renderPlantUmlSvg("@startuml\nAlice -> Bob\n@enduml", {
      fetcher: async () => new Response(
        '<svg><script>window.alert("no")</script><text>safe</text></svg>',
      ),
    });

    expect(result).toContain("<svg");
    expect(result).toContain("safe");
    expect(result).not.toContain("<script");
    expect(sanitizeDiagramSvgMock).toHaveBeenCalledOnce();
  });

  it("reports an HTTP status as a typed renderer error", async () => {
    await expect(renderPlantUmlSvg("@startuml\n@enduml", {
      fetcher: async () => new Response("Unavailable", { status: 503 }),
    })).rejects.toMatchObject({
      kind: "httpStatus",
      name: "PlantUmlRenderError",
      status: 503,
    });
  });

  it("rejects non-SVG responses before they reach the document", async () => {
    await expect(renderPlantUmlSvg("@startuml\n@enduml", {
      fetcher: async () => new Response("not an SVG"),
    })).rejects.toMatchObject({
      kind: "invalidSvg",
      name: "PlantUmlRenderError",
    });
  });

  it("aborts a stalled remote render at the configured timeout", async () => {
    let aborted = false;
    const fetcher: typeof fetch = (_input, init) => new Promise<Response>(
      (_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        }, { once: true });
      },
    );

    await expect(renderPlantUmlSvg("@startuml\n@enduml", {
      fetcher,
      timeoutMs: 1,
    })).rejects.toMatchObject({
      kind: "timeout",
      name: "PlantUmlRenderError",
    });
    expect(aborted).toBe(true);
  });
});
