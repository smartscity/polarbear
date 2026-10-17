import { beforeEach, expect, it, vi } from "vitest";
import { captionRequest, type CaptionStatus } from "./captionAdapter";
import { changeCaptionSource } from "./captionCommands";
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

it("finishes system capture before explicitly starting microphone capture", async () => {
  await changeCaptionSource("microphone");
  expect(vi.mocked(captionRequest).mock.calls.map(([request]) => request.action)).toEqual(["status", "stop", "start"]);
  expect(captionRequest).toHaveBeenLastCalledWith({ action: "start", source: "microphone", timezone: expect.any(String) });
  expect(updateUserSettings).toHaveBeenCalledWith({ caption: { ...DEFAULT_USER_SETTINGS.caption, source: "microphone" } });
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
