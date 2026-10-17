import { afterEach, expect, it, vi } from "vitest";
import { gunzip } from "fflate";
import { loadBundledModel } from "./bundledModel";

vi.mock("fflate", () => ({ gunzip: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("reports missing packaged assets without attempting any remote fallback", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  await expect(loadBundledModel(new AbortController().signal)).rejects.toMatchObject({ code: "bundledModelMissing" });
  expect(fetch).toHaveBeenCalledTimes(4);
  for (const [url, options] of fetch.mock.calls) {
    expect(url).toMatch(/^\/models\/en-zh\//);
    expect(options).toMatchObject({ credentials: "omit", redirect: "error" });
  }
});

it("verifies compressed integrity before starting decompression", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(new Uint8Array([0x1f, 0x8b, 0, 1]))));
  await expect(loadBundledModel(new AbortController().signal)).rejects.toMatchObject({ code: "bundledModelInvalid" });
  expect(gunzip).not.toHaveBeenCalled();
});

it("rejects unexpected successful HTML responses as invalid model assets", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("<!doctype html>")));
  await expect(loadBundledModel(new AbortController().signal)).rejects.toMatchObject({ code: "bundledModelInvalid" });
  expect(gunzip).not.toHaveBeenCalled();
});
