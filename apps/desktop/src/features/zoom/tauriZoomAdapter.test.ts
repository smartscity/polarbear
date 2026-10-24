import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
import { listen } from "@tauri-apps/api/event";
import { subscribeNativePinch } from "./tauriZoomAdapter";

afterEach(() => vi.resetAllMocks());

describe("native pinch subscription lifetime", () => {
  it.each([false, true])("contains asynchronous teardown failure after disposal (late registration: %s)", async (late) => {
    let finish!: (dispose: () => void) => void;
    vi.mocked(listen).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const error = new Error("native unlisten rejected");
    const diagnostic = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onError = vi.fn(), unlisten = vi.fn().mockRejectedValue(error);
    const dispose = subscribeNativePinch(vi.fn(), onError);
    try {
      if (late) dispose();
      finish(unlisten);
      await Promise.resolve();
      dispose();
      await vi.waitFor(() => expect(diagnostic).toHaveBeenCalledWith("Native pinch subscription cleanup failed", error));
      expect(unlisten).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
    } finally { diagnostic.mockRestore(); }
  });

  it("reports registration rejection through the owning status callback", async () => {
    const error = new Error("native subscription denied"), onError = vi.fn();
    vi.mocked(listen).mockRejectedValue(error);
    const dispose = subscribeNativePinch(vi.fn(), onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    dispose();
  });

  it("releases late registrations once and ignores queued events after disposal", async () => {
    let finish!: (dispose: () => void) => void;
    vi.mocked(listen).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const onPinch = vi.fn(), onError = vi.fn(), unlisten = vi.fn();
    const dispose = subscribeNativePinch(onPinch, onError);
    const handler = vi.mocked(listen).mock.calls[0][1];
    handler({ event: "pinch", id: 1, payload: { scale: 1.2 } });
    expect(onPinch).toHaveBeenCalledOnce();
    dispose(); dispose();
    handler({ event: "pinch", id: 1, payload: { scale: 1.3 } });
    finish(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(onPinch).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not surface a registration failure after its owner has closed", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(listen).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const onError = vi.fn();
    const dispose = subscribeNativePinch(vi.fn(), onError);
    dispose(); fail(new Error("late failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).not.toHaveBeenCalled();
  });
});
