import { beforeEach, expect, it, vi } from "vitest";
import { captionRequest, type CaptionStatus } from "./captionAdapter";
import { changeCaptionSource, executeCaptionCommand } from "./captionCommands";
import { DEFAULT_USER_SETTINGS, readUserSettings, updateUserSettings } from "../../shared/settings/userSettings";

vi.mock("./captionAdapter", () => ({ captionRequest: vi.fn() }));
vi.mock("../../shared/settings/userSettings", async (original) => ({
  ...await original<typeof import("../../shared/settings/userSettings")>(),
  readUserSettings: vi.fn(), updateUserSettings: vi.fn(),
}));

const status: CaptionStatus = { sessionId: "old", state: "capturing", source: "system", partial: "", error: null, elapsedMs: 1000, audioLevel: 0, viewRevision: 0, historyRequested: false };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readUserSettings).mockReturnValue(DEFAULT_USER_SETTINGS);
  vi.mocked(captionRequest).mockResolvedValue(status);
});

it.each(["system", "microphone"] as const)("starts captions with the saved %s source through the idempotent native request", async (source) => {
  vi.mocked(readUserSettings).mockReturnValue({ ...DEFAULT_USER_SETTINGS, caption: { ...DEFAULT_USER_SETTINGS.caption, source } });
  await executeCaptionCommand("caption.start");
  expect(captionRequest).toHaveBeenCalledExactlyOnceWith({ action: "start", source, timezone: expect.any(String) });
  expect(updateUserSettings).not.toHaveBeenCalled();
});

it("never turns repeated activation into stop or resume requests", async () => {
  await Promise.all([executeCaptionCommand("caption.start"), executeCaptionCommand("caption.start")]);
  expect(vi.mocked(captionRequest).mock.calls.map(([request]) => request.action)).toEqual(["start", "start"]);
});

it("propagates activation failures without changing preferences or retrying capture", async () => {
  vi.mocked(captionRequest).mockRejectedValueOnce(new Error("microphone denied"));
  await expect(executeCaptionCommand("caption.start")).rejects.toThrow("microphone denied");
  expect(captionRequest).toHaveBeenCalledTimes(1);
  expect(updateUserSettings).not.toHaveBeenCalled();
});

it("keeps the settings switch able to stop active capture", async () => {
  await executeCaptionCommand("caption.toggle");
  expect(vi.mocked(captionRequest).mock.calls.map(([request]) => request.action)).toEqual(["status", "stop"]);
});

it("uses the same activation request when the settings switch is turned on", async () => {
  vi.mocked(captionRequest).mockResolvedValueOnce({ ...status, state: "stopped" });
  await executeCaptionCommand("caption.toggle");
  expect(vi.mocked(captionRequest).mock.calls.map(([request]) => request.action)).toEqual(["status", "start"]);
});

it("finishes system capture before explicitly starting microphone capture", async () => {
  await changeCaptionSource("microphone");
  expect(vi.mocked(captionRequest).mock.calls.map(([request]) => request.action)).toEqual(["status", "stop", "start"]);
  expect(captionRequest).toHaveBeenLastCalledWith({ action: "start", source: "microphone", timezone: expect.any(String) });
  expect(updateUserSettings).toHaveBeenCalledWith({ caption: { source: "microphone" } });
});

it.each(["idle", "stopped", "failed", "paused"])("does not start recording implicitly from %s", async (state) => {
  vi.mocked(captionRequest).mockResolvedValue({ ...status, state });
  await changeCaptionSource("microphone");
  expect(vi.mocked(captionRequest).mock.calls.some(([request]) => request.action === "start")).toBe(false);
});

it("does not restart an unchanged source", async () => {
  await changeCaptionSource("system");
  expect(captionRequest).toHaveBeenCalledTimes(1);
});

it("preserves the source preference and propagates a stop failure", async () => {
  vi.mocked(captionRequest).mockResolvedValueOnce(status).mockRejectedValueOnce(new Error("stop failed"));
  await expect(changeCaptionSource("microphone")).rejects.toThrow("stop failed");
  expect(updateUserSettings).not.toHaveBeenCalled();
  expect(captionRequest).toHaveBeenCalledTimes(2);
});

it("reports microphone startup failure without restarting the previous capture", async () => {
  vi.mocked(captionRequest).mockResolvedValueOnce(status).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("microphone denied"));
  await expect(changeCaptionSource("microphone")).rejects.toThrow("microphone denied");
  expect(captionRequest).toHaveBeenCalledTimes(3);
  expect(updateUserSettings).toHaveBeenCalled();
});

it("waits for settings acknowledgment and does not start capture after a persistence failure", async () => {
  vi.mocked(updateUserSettings).mockRejectedValueOnce(new Error("Storage full"));
  await expect(changeCaptionSource("microphone")).rejects.toThrow("Storage full");
  expect(vi.mocked(captionRequest).mock.calls.map(([request]) => request.action)).toEqual(["status", "stop"]);
});
