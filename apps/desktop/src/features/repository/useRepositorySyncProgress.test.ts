import { afterEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock("react", () => ({ useEffect: (effect: () => () => void) => { lifecycle.cleanup = effect(); } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
import { listen } from "@tauri-apps/api/event";
import { useRepositorySyncProgress } from "./useRepositorySyncProgress";

afterEach(() => { lifecycle.cleanup?.(); vi.resetAllMocks(); });

describe("repository progress subscription", () => {
  it("reports a registration failure instead of leaving a rejected promise unhandled", async () => {
    const failure = new Error("native listener unavailable");
    vi.mocked(listen).mockRejectedValue(failure);
    const onError = vi.fn();
    useRepositorySyncProgress({ busyRef: { current: true }, onProgress: vi.fn(), onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
  });

  it("releases a registration that completes after disposal", async () => {
    let complete!: (stop: () => void) => void;
    vi.mocked(listen).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const stop = vi.fn();
    useRepositorySyncProgress({ busyRef: { current: true }, onProgress: vi.fn(), onError: vi.fn() });
    lifecycle.cleanup?.();
    complete(stop);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("ignores queued events and registration failures after disposal", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(listen).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const onProgress = vi.fn(); const onError = vi.fn();
    useRepositorySyncProgress({ busyRef: { current: true }, onProgress, onError });
    const handler = vi.mocked(listen).mock.calls[0][1];
    lifecycle.cleanup?.();
    handler({ event: "progress", id: 1, payload: { phase: "late" } });
    fail(new Error("late failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onProgress).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
