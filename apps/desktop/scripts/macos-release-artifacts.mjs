import { readdir, stat, readFile, appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export async function locateMacosArtifacts({ targetDirectory, target, productName }) {
  const bundle = join(targetDirectory, ...(target ? [target] : []), "release/bundle");
  const app = join(bundle, "macos", `${productName}.app`);
  if (!(await stat(app).catch(() => null))?.isDirectory()) {
    throw new Error(`Packaged app missing: ${app}. Build with --bundles app,dmg; dmg-only builds remove the intermediate app.`);
  }
  const assets = join(app, "Contents/Resources/resources/caption");
  if (!(await stat(join(assets, "polarbear-caption-engine")).catch(() => null))?.isFile()) {
    throw new Error(`Packaged caption engine missing: ${assets}. Source-tree resources are not a substitute.`);
  }
  const dmgDirectory = join(bundle, "dmg");
  const images = (await readdir(dmgDirectory, { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.isFile() && entry.name.endsWith(".dmg"));
  if (images.length !== 1) {
    throw new Error(`Expected exactly one DMG in ${dmgDirectory}; found ${images.length}. Refusing to select a stale or ambiguous artifact.`);
  }
  return { APP_BUNDLE: app, CAPTION_ASSETS: assets, DMG_SOURCE: join(dmgDirectory, images[0].name) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { target: { type: "string" }, "github-env": { type: "boolean" } } });
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const result = spawnSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], { cwd: root, encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) throw new Error("Cannot resolve Cargo target directory", { cause: result.error || result.stderr });
  const metadata = JSON.parse(result.stdout);
  const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const artifacts = await locateMacosArtifacts({ targetDirectory: metadata.target_directory, target: values.target, productName: config.productName });
  console.log(JSON.stringify(artifacts, null, 2));
  if (values["github-env"]) {
    if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required");
    for (const value of Object.values(artifacts)) {
      if (/[\r\n]/.test(value)) throw new Error("Artifact paths cannot contain newlines");
    }
    await appendFile(process.env.GITHUB_ENV, Object.entries(artifacts).map(([key, value]) => `${key}=${value}\n`).join(""));
  }
}
