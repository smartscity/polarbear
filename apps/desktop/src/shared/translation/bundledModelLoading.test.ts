import { gzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { loadBundledModel } from "./bundledModel";

vi.mock("./modelManifest.json", async () => {
  const { createHash } = await import("node:crypto");
  const { gzipSync } = await import("node:zlib");
  const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  return { default: { from: "en", to: "zh", files: Object.fromEntries(
    ["model", "lex", "srcvocab", "trgvocab"].map(key => {
      const decoded = Buffer.from(`fixture:${key}.gz`);
      return [key, { name: `${key}.gz`, sha256: digest(decoded), compressedSha256: digest(gzipSync(decoded)) }];
    }),
  ) } };
});

afterEach(() => vi.unstubAllGlobals());

function serveModels(compressed = true) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const decoded = Buffer.from(`fixture:${url.split("/").at(-1)}`);
    return new Response(compressed ? gzipSync(decoded) : decoded);
  }));
}

function expectModel(model: Awaited<ReturnType<typeof loadBundledModel>>) {
  const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);
  expect(decode(model.model)).toBe("fixture:model.gz");
  expect(decode(model.shortlist)).toBe("fixture:lex.gz");
  expect(model.vocabs.map(decode)).toEqual(["fixture:srcvocab.gz", "fixture:trgvocab.gz"]);
}

it("loads and verifies every asset through native streaming decompression", async () => {
  serveModels();
  const native = DecompressionStream;
  const constructed = vi.fn();
  vi.stubGlobal("DecompressionStream", class extends native {
    constructor(format: CompressionFormat) { super(format); constructed(format); }
  });
  expectModel(await loadBundledModel(new AbortController().signal));
  expect(constructed).toHaveBeenCalledTimes(4);
  expect(constructed).toHaveBeenCalledWith("gzip");
});

it("keeps the worker decompression fallback for older webviews", async () => {
  serveModels();
  vi.stubGlobal("DecompressionStream", undefined);
  expectModel(await loadBundledModel(new AbortController().signal));
});

it("accepts already decoded HTTP bodies only after checking decoded integrity", async () => {
  serveModels(false);
  expectModel(await loadBundledModel(new AbortController().signal));
});

it("rejects cancellation before decompression without constructing a stream", async () => {
  serveModels();
  const constructed = vi.fn();
  vi.stubGlobal("DecompressionStream", constructed);
  const controller = new AbortController();
  controller.abort();
  await expect(loadBundledModel(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(constructed).not.toHaveBeenCalled();
});

it("propagates cancellation into a native decompression stream", async () => {
  serveModels();
  const native = DecompressionStream;
  const controller = new AbortController();
  vi.stubGlobal("DecompressionStream", class extends native {
    constructor(format: CompressionFormat) { super(format); controller.abort(); }
  });
  await expect(loadBundledModel(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});
