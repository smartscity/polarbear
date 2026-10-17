import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locateMacosArtifacts } from "./macos-release-artifacts.mjs";

async function fixture(t, target) {
  const root = await mkdtemp(join(tmpdir(), "caption package "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { targetDirectory: root, target, productName: "Polar Bear" };
  const bundle = join(root, ...(target ? [target] : []), "release/bundle");
  const app = join(bundle, "macos/Polar Bear.app");
  const assets = join(app, "Contents/Resources/resources/caption");
  const dmg = join(bundle, "dmg/Polar Bear.dmg");
  await mkdir(assets, { recursive: true });
  await mkdir(join(bundle, "dmg"), { recursive: true });
  await writeFile(join(assets, "polarbear-caption-engine"), "fixture");
  await writeFile(dmg, "fixture");
  return { options, app, assets, dmg };
}

test("locates a universal app and DMG under Cargo's custom target directory", async t => {
  const f = await fixture(t, "universal-apple-darwin");
  assert.deepEqual(await locateMacosArtifacts(f.options), { APP_BUNDLE: f.app, CAPTION_ASSETS: f.assets, DMG_SOURCE: f.dmg });
});

test("supports native build output and product paths containing spaces", async t => {
  const f = await fixture(t);
  assert.equal((await locateMacosArtifacts(f.options)).APP_BUNDLE, f.app);
});

test("reports the dmg-only cleanup regression even when the DMG exists", async t => {
  const f = await fixture(t, "universal-apple-darwin");
  await rm(f.app, { recursive: true });
  await assert.rejects(locateMacosArtifacts(f.options), /Build with --bundles app,dmg/);
});

test("does not fall back to source resources when the packaged helper is missing", async t => {
  const f = await fixture(t);
  await rm(join(f.assets, "polarbear-caption-engine"));
  await assert.rejects(locateMacosArtifacts(f.options), /Packaged caption engine missing/);
});

test("rejects missing or ambiguous DMGs rather than picking the first file", async t => {
  const f = await fixture(t);
  await writeFile(join(f.dmg, "../old.dmg"), "stale");
  await assert.rejects(locateMacosArtifacts(f.options), /found 2/);
  await rm(f.dmg);
  await rm(join(f.dmg, "../old.dmg"));
  await assert.rejects(locateMacosArtifacts(f.options), /found 0/);
});

test("release workflow retains the app and verifies the mounted DMG before upload", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(workflow, /tauri build --target universal-apple-darwin --bundles app,dmg/);
  assert.match(workflow, /macos-release-artifacts\.mjs --target universal-apple-darwin --github-env/);
  assert.match(workflow, /hdiutil attach .* -readonly -nobrowse/);
  assert.ok(workflow.indexOf("Verify caption engine inside DMG") < workflow.indexOf("Upload DMG build artifact"));
  assert.match(workflow, /name: Upload DMG to GitHub Release\s+if: env\.RELEASE_TAG != ''/);
  assert.match(workflow, /branches:\s+- main/);
});
