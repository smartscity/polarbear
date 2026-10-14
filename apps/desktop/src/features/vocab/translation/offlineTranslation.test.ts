import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineTranslation } from "./offlineTranslation";
import { TranslationError } from "./translationError";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe("offline reading translation lifecycle", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("reuses a successful worker and releases it after the idle deadline", async () => {
    vi.useFakeTimers();
    const engine = { translate: vi.fn().mockResolvedValue("translated"), dispose: vi.fn() };
    const create = vi.fn().mockResolvedValue(engine);
    const service = new OfflineTranslation(create);
    expect(await service.translate("First sentence.")).toBe("translated");
    await service.translate("Second sentence.");
    expect(create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });

  it("terminates superseded inference without allowing stale results to win", async () => {
    const pending = deferred<string>();
    const old = { translate: () => pending.promise, dispose: vi.fn() };
    const next = { translate: async () => "new result", dispose: vi.fn() };
    const service = new OfflineTranslation(vi.fn().mockResolvedValueOnce(old).mockResolvedValue(next));
    const first = service.translate("Old selection.");
    const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(await service.translate("New selection.")).toBe("new result");
    await cancelled;
    pending.resolve("stale");
    await Promise.resolve();
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(next.dispose).not.toHaveBeenCalled();
    service.dispose();
  });

  it("cleans up an engine whose factory finishes after cancellation", async () => {
    const engine = { translate: vi.fn(), dispose: vi.fn() };
    const loading = deferred<typeof engine>();
    const service = new OfflineTranslation(() => loading.promise);
    const controller = new AbortController();
    const result = service.translate("Cancelled selection.", controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected;
    loading.resolve(engine); await Promise.resolve();
    expect(engine.translate).not.toHaveBeenCalled();
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });

  it("times out stalled initialization and permits retry", async () => {
    vi.useFakeTimers();
    const engine = { translate: () => new Promise<string>(() => {}), dispose: vi.fn() };
    const service = new OfflineTranslation(async () => engine);
    const result = expect(service.translate("A sentence.")).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(60_000); await result;
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it("preserves model integrity errors and resets failed engines", async () => {
    const engine = { translate: vi.fn().mockRejectedValue(new TranslationError("bundledModelInvalid")), dispose: vi.fn() };
    const create = vi.fn().mockResolvedValue(engine);
    const service = new OfflineTranslation(create);
    await expect(service.translate("One sentence.")).rejects.toMatchObject({ code: "bundledModelInvalid" });
    await expect(service.translate("Retry sentence.")).rejects.toMatchObject({ code: "bundledModelInvalid" });
    expect(create).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it("does not initialize for empty, oversized or already cancelled selections", async () => {
    const create = vi.fn(); const service = new OfflineTranslation(create);
    await expect(service.translate(" ")).rejects.toMatchObject({ code: "translationFailed" });
    await expect(service.translate("x".repeat(8001))).rejects.toMatchObject({ code: "translationFailed" });
    await expect(service.translate("text", AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(create).not.toHaveBeenCalled();
  });
});
