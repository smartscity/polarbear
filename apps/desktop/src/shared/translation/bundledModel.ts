import { gunzip } from "fflate";
import manifest from "./modelManifest.json";
import { TranslationError } from "./translationError";

export const MODEL_PAIR = { from: manifest.from, to: manifest.to };

export async function loadBundledModel(signal: AbortSignal) {
  const parts = await Promise.all(Object.entries(manifest.files).map(async ([key, file]) => {
    const response = await fetch(`/models/en-zh/${file.name}`, { signal, credentials: "omit", redirect: "error" });
    if (!response.ok) throw new TranslationError("bundledModelMissing");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Some servers decompress .gz assets in transit. Verify the decoded bytes in either case.
    const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (compressed) await verify(bytes.buffer, file.compressedSha256);
    const decoded = compressed ? await decompress(bytes, signal) : bytes;
    signal.throwIfAborted();
    const buffer = new Uint8Array(decoded).buffer;
    await verify(buffer, file.sha256);
    return [key, buffer] as const;
  }));
  signal.throwIfAborted();
  const buffers = Object.fromEntries(parts);
  return { model: buffers.model, shortlist: buffers.lex, vocabs: [buffers.srcvocab, buffers.trgvocab], config: {} };
}

async function verify(buffer: ArrayBuffer, expected: string) {
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  if (hash !== expected) throw new TranslationError("bundledModelInvalid");
}

async function decompress(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  if (typeof DecompressionStream !== "undefined") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"), { signal });
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const abort = () => { stop(); reject(signal.reason); };
    const stop = gunzip(bytes, (error, result) => {
      signal.removeEventListener("abort", abort);
      if (error) reject(new TranslationError("bundledModelInvalid", { cause: error }));
      else resolve(result);
    });
    signal.addEventListener("abort", abort, { once: true });
  });
}
