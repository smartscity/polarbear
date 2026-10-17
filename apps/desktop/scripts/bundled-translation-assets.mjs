import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const engine = dirname(require.resolve("@browsermt/bergamot-translator/translator.js"));
const modelRoot = fileURLToPath(new URL("../public/models/en-zh/", import.meta.url));
const manifestPath = fileURLToPath(new URL("../src/shared/translation/modelManifest.json", import.meta.url));
const runtimeFiles = ["translator-worker.js", "bergamot-translator-worker.js", "bergamot-translator-worker.wasm"];

export function verifyTranslationAssets() {
  const { files } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  for (const file of Object.values(files)) {
    const bytes = readFileSync(join(modelRoot, file.name));
    if (digest(bytes) !== file.compressedSha256 || digest(gunzipSync(bytes)) !== file.sha256) {
      throw new Error(`Bundled translation model integrity failed: ${file.name}`);
    }
  }
  for (const file of runtimeFiles) readFileSync(join(engine, "worker", file));
}

/** Serve upstream classic workers unchanged so importScripts and WASM URLs stay adjacent. */
export function bundledTranslationAssets() {
  return {
    name: "bundled-translation-assets",
    buildStart() { verifyTranslationAssets(); },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = req.url?.split("?")[0]?.replace(/^\/translation-runtime\//, "");
        if (!req.url?.startsWith("/translation-runtime/") || !runtimeFiles.includes(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "application/javascript");
        res.end(readFileSync(join(engine, "worker", file)));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "models/en-zh/manifest.json", source: readFileSync(manifestPath) });
      for (const file of runtimeFiles) this.emitFile({ type: "asset", fileName: `translation-runtime/${file}`, source: readFileSync(join(engine, "worker", file)) });
      this.emitFile({ type: "asset", fileName: "translation-runtime/LICENSE", source: readFileSync(join(modelRoot, "LICENSE-MPL-2.0.txt")) });
      this.emitFile({ type: "asset", fileName: "translation-runtime/fflate-LICENSE.txt", source: readFileSync(join(dirname(require.resolve("fflate")), "..", "LICENSE")) });
    },
  };
}
