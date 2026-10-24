import { describe, expect, it, vi } from "vitest";
import { DiagramRenderCache } from "./diagramRenderCache";

describe("diagram render cache", () => {
  it("bounds distinct pending sources and admits another after cancellation", async () => {
    const cache = new DiagramRenderCache();
    const owners = Array.from({ length: 32 }, () => new AbortController());
    const requests = owners.map((owner, index) => cache.getOrRender(String(index), (signal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }), owner.signal));
    const settled = Promise.allSettled(requests);
    await expect(cache.getOrRender("overflow", async () => "never")).rejects.toMatchObject({ name: "DiagramBusyError" });
    owners.forEach((owner) => owner.abort()); await settled;
    await expect(cache.getOrRender("current", async () => "svg")).resolves.toBe("svg");
  });
  it("cancels shared work only after its last preview is disposed", async () => {
    const cache = new DiagramRenderCache();
    const a = new AbortController(), b = new AbortController();
    let signal!: AbortSignal, finish!: (svg: string) => void;
    const render = vi.fn((owner: AbortSignal) => { signal = owner; return new Promise<string>((resolve) => { finish = resolve; }); });
    const first = cache.getOrRender("shared", render, a.signal);
    const second = cache.getOrRender("shared", render, b.signal);
    await Promise.resolve(); a.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(signal.aborted).toBe(false); finish("svg");
    await expect(second).resolves.toBe("svg"); expect(render).toHaveBeenCalledTimes(1);
  });
  it("releases an abandoned source without caching its late completion", async () => {
    const cache = new DiagramRenderCache(), controller = new AbortController();
    let finish!: (svg: string) => void, signal!: AbortSignal;
    const request = cache.getOrRender("stale", (owner) => { signal = owner; return new Promise((resolve) => { finish = resolve; }); }, controller.signal);
    await Promise.resolve(); controller.abort(); await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(signal.aborted).toBe(true);
    await expect(cache.getOrRender("stale", async () => "new")).resolves.toBe("new");
    finish("old"); await Promise.resolve(); await Promise.resolve();
    await expect(cache.getOrRender("stale", async () => "unexpected")).resolves.toBe("new");
  });
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
