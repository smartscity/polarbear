import { createHash } from "node:crypto";
import { readFile, mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../src-tauri/", import.meta.url));
const assets = join(root, "resources/caption");
const source = join(root, "native/caption-engine");
const manifest = JSON.parse(await readFile(join(assets, "manifest.json"), "utf8"));
async function verify(file, expected) {
  const digest = createHash("sha256").update(await readFile(file)).digest("hex");
  if (digest !== expected) throw new Error(`Caption asset integrity mismatch: ${file}`);
}
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) throw new Error(`Caption build failed: ${command}`);
}
if (process.platform === "darwin") {
  for (const model of manifest.models) await verify(join(assets, model.file), model.sha256);
  const archive = join(source, "whisper-source.tar.gz");
  await verify(archive, manifest.engine.archiveSha256);
  const cache = join(root, "target/caption-native");
  await mkdir(cache, { recursive: true });
  run("/usr/bin/tar", ["-xzf", archive, "-C", cache]);
  const whisper = join(cache, `whisper.cpp-${manifest.engine.commit}`);
  const requested = process.env.TAURI_ENV_TARGET_TRIPLE;
  const architectures = requested === "universal-apple-darwin" || process.argv.includes("--universal")
    ? ["arm64", "x86_64"] : [requested?.startsWith("aarch64") || (!requested && process.arch === "arm64") ? "arm64" : "x86_64"];
  const binaries = [];
  for (const architecture of architectures) {
    const build = join(cache, architecture);
    run("cmake", ["-S", source, "-B", build, `-DWHISPER_SOURCE=${whisper}`, "-DCMAKE_BUILD_TYPE=Release",
      `-DCMAKE_OSX_ARCHITECTURES=${architecture}`, "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0",
      "-DGGML_BLAS=OFF", "-DGGML_METAL=OFF"]);
    run("cmake", ["--build", build, "--config", "Release", "-j", "4"]);
    const hostArchitecture = process.arch === "arm64" ? "arm64" : "x86_64";
    if (architecture === hostArchitecture) run("ctest", ["--test-dir", build, "--output-on-failure"]);
    binaries.push(join(build, "polarbear-caption-engine"));
  }
  const binary = join(assets, "polarbear-caption-engine");
  if (binaries.length === 2) run("/usr/bin/lipo", ["-create", ...binaries, "-output", binary]);
  else await copyFile(binaries[0], binary);
  run("/usr/bin/codesign", ["--force", "--sign", process.env.APPLE_SIGNING_IDENTITY || "-", "--timestamp=none", binary]);
  run("/usr/bin/lipo", ["-info", binary]);
  console.log("Caption engine and offline models verified. No runtime download is required.");
}
