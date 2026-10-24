import { describe, expect, it, vi } from "vitest";
import { DiagramRenderQueue } from "./diagramRenderQueue";

const deferred = () => { let resolve!: (value: string) => void; const promise = new Promise<string>((done) => { resolve = done; }); return { promise, resolve }; };
describe("diagram render admission", () => {
  it("bounds active and queued work and rejects excess without invoking it", async () => {
    const queue = new DiagramRenderQueue({ concurrency: 1, pending: 1, codeUnits: 10 });
    const active = deferred(), waiting = vi.fn(async () => "second"), excess = vi.fn(async () => "excess");
    const first = queue.run("first", () => active.promise);
    const second = queue.run("next", waiting);
    await expect(queue.run("x", excess)).rejects.toMatchObject({ name: "DiagramBusyError" });
    expect(waiting).not.toHaveBeenCalled(); expect(excess).not.toHaveBeenCalled();
    active.resolve("first"); await expect(first).resolves.toBe("first"); await expect(second).resolves.toBe("second");
  });
  it("removes cancelled queued work without entering the renderer", async () => {
    const queue = new DiagramRenderQueue({ concurrency: 1, pending: 1, codeUnits: 10 });
    const active = deferred(), controller = new AbortController(), render = vi.fn(async () => "stale");
    const first = queue.run("a", () => active.promise);
    const cancelled = queue.run("b", render, controller.signal);
    controller.abort(); await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    const next = queue.run("c", async () => "current");
    active.resolve("first"); await first; await expect(next).resolves.toBe("current"); expect(render).not.toHaveBeenCalled();
  });
  it("retains capacity until an uncancellable active engine actually settles", async () => {
    const queue = new DiagramRenderQueue({ concurrency: 1, pending: 1, codeUnits: 10 });
    const active = deferred(), controller = new AbortController(), next = vi.fn(async () => "next");
    const first = queue.run("a", () => active.promise, controller.signal);
    await Promise.resolve(); controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = queue.run("b", next); expect(next).not.toHaveBeenCalled();
    active.resolve("stale"); await expect(second).resolves.toBe("next");
  });
  it("limits retained source bytes and releases rejected engine work", async () => {
    const queue = new DiagramRenderQueue({ concurrency: 1, pending: 3, codeUnits: 4 });
    await expect(queue.run("oversized", async () => "never")).rejects.toMatchObject({ name: "DiagramBusyError" });
    await expect(queue.run("a", async () => { throw new Error("invalid"); })).rejects.toThrow("invalid");
    await expect(queue.run("b", async () => "valid")).resolves.toBe("valid");
  });
});
