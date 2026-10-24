import { afterEach, expect, it, vi } from "vitest";
import { connectRepositoryProvider, disconnectRepositoryProvider, getRepositoryAccount, isRepositoryCleanupPending } from "./repositoryApi";
import { invokeTauri, TauriCommandError } from "../../shared/tauri/invokeTauri";

vi.mock("../../shared/tauri/invokeTauri", async (original) => ({
  ...await original<typeof import("../../shared/tauri/invokeTauri")>(), invokeTauri: vi.fn(),
}));
vi.mock("../../shared/i18n/translate", () => ({ translateCurrent: (key: string) => `localized:${key}` }));
afterEach(() => vi.resetAllMocks());

it("localizes secure credential publication failure without acknowledging a connection", async () => {
  const cause = new TauriCommandError("repository_connect_provider", {
    code: "repository.secretWriteFailed", message: "private filesystem detail",
  });
  vi.mocked(invokeTauri).mockRejectedValue(cause);
  const error = await connectRepositoryProvider({ provider: "github", token: "fixture" }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("localized:repository.secretWriteFailed");
  expect((error as Error).cause).toBe(cause);
  expect(isRepositoryCleanupPending(error)).toBe(false);
});

it("keeps successful connections and unrelated provider errors unchanged", async () => {
  const account = { provider: "github", accountId: "1", login: "fixture", connectedAt: 1 };
  const error = new Error("provider unavailable");
  vi.mocked(invokeTauri).mockResolvedValueOnce(account).mockRejectedValueOnce(error);
  await expect(connectRepositoryProvider({ provider: "github", token: "fixture" })).resolves.toBe(account);
  await expect(connectRepositoryProvider({ provider: "github", token: "fixture" })).rejects.toBe(error);
});

it.each(["repository.secretDeletionFailed", "repository.secretReadFailed"])("preserves the recovery code while localizing %s on startup", async (code) => {
  vi.mocked(invokeTauri).mockRejectedValue(new TauriCommandError("repository_get_account", {
    code, message: "private native detail",
  }));
  const error = await getRepositoryAccount().catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(`localized:${code}`);
  expect(isRepositoryCleanupPending(error)).toBe(code === "repository.secretDeletionFailed");
});

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
