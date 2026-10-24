import { afterEach, expect, it, vi } from "vitest";
import { disconnectRepositoryProvider } from "./repositoryApi";
import { invokeTauri, TauriCommandError } from "../../shared/tauri/invokeTauri";

vi.mock("../../shared/tauri/invokeTauri", async (original) => ({
  ...await original<typeof import("../../shared/tauri/invokeTauri")>(), invokeTauri: vi.fn(),
}));
vi.mock("../../shared/i18n/translate", () => ({ translateCurrent: (key: string) => `localized:${key}` }));
afterEach(() => vi.resetAllMocks());

it("localizes credential deletion failure without reporting disconnect success", async () => {
  vi.mocked(invokeTauri).mockRejectedValue(new TauriCommandError("repository_disconnect_provider", {
    code: "repository.secretDeletionFailed", message: "fallback diagnostic",
  }));
  await expect(disconnectRepositoryProvider()).rejects.toThrow("localized:repository.secretDeletionFailed");
});

it("preserves unrelated disconnect errors and successful completion", async () => {
  const error = new Error("account persistence failure");
  vi.mocked(invokeTauri).mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
  await expect(disconnectRepositoryProvider()).rejects.toBe(error);
  await expect(disconnectRepositoryProvider()).resolves.toBeUndefined();
});
