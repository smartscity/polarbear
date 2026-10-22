import { describe, expect, it, vi } from "vitest";
import { DiagramRenderCache } from "./diagramRenderCache";

describe("diagram render cache", () => {
  it("shares concurrent work and reuses completed SVG", async () => {
    const cache = new DiagramRenderCache();
    const render = vi.fn(async () => "<svg/>");
    const a = cache.getOrRender("a", render);
    expect(cache.getOrRender("a", render)).toBe(a);
    await a; await cache.getOrRender("a", render);
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("evicts least recently used entries", async () => {
    const cache = new DiagramRenderCache({ entries: 2, codeUnits: 100 });
    const render = vi.fn(async () => "svg");
    for (const key of ["a", "b", "a", "c", "a"]) await cache.getOrRender(key, render);
    expect(render).toHaveBeenCalledTimes(3);
    await cache.getOrRender("b", render);
    expect(render).toHaveBeenCalledTimes(4);
  });
  it("bounds retained source and SVG size and bypasses oversized entries", async () => {
    const cache = new DiagramRenderCache({ entries: 32, codeUnits: 10 });
    const render = vi.fn(async () => "12345");
    await cache.getOrRender("a", render); await cache.getOrRender("b", render);
    await cache.getOrRender("a", render);
    expect(render).toHaveBeenCalledTimes(3);
    await cache.getOrRender("oversized", render); await cache.getOrRender("oversized", render);
    expect(render).toHaveBeenCalledTimes(5);
    await cache.getOrRender("a", render);
    expect(render).toHaveBeenCalledTimes(5);
  });
  it("retries failures instead of keeping a permanent localized error", async () => {
    const cache = new DiagramRenderCache();
    await expect(cache.getOrRender("a", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    await expect(cache.getOrRender("a", async () => "svg")).resolves.toBe("svg");
  });
});
