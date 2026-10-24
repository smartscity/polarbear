import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auditArchitecture, cyclesIn, root } from "./architecture-graph.mjs";

test("detects self and indirect dependency cycles without rejecting shared leaves", () => {
  assert.deepEqual(cyclesIn(new Map([["a", ["b", "c"]], ["b", ["c"]], ["c", []]])), []);
  assert.deepEqual(cyclesIn(new Map([["a", ["b"]], ["b", ["a"]], ["c", ["c"]]])), [["a", "b", "a"], ["c", "c"]]);
});

test("production imports have no runtime cycles or reverse shared and feature dependencies", () => {
  const report = auditArchitecture();
  assert.deepEqual(report.runtimeCycles, []);
  assert.deepEqual(report.forbidden, []);
  assert.deepEqual(report.unresolved, []);
});

test("quality and macOS release keep native correctness and all-target lint checks", () => {
  for (const file of ["quality.yml", "release.yml"]) {
    const workflow = readFileSync(join(root, ".github/workflows", file), "utf8");
    assert.match(workflow, /cargo clippy --all-targets --all-features -- -D warnings/);
    assert.match(workflow, /cargo test --manifest-path apps\/desktop\/src-tauri\/Cargo.toml --no-fail-fast/);
    assert.match(workflow, /npm --workspace apps\/desktop run memory-contract:check/);
  }
  const release = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
  assert.match(release, /npm --workspace apps\/desktop run test:ui/);
  assert.match(release, /npm --workspace apps\/desktop run test:offline-translation -- --webkit/);
  assert.match(release, /test:native-clipboard -- test-results\/real-mermaid-clipboard.json/);
});

test("quality runs on engineering branch pushes without requiring a release tag", () => {
  const workflow = readFileSync(join(root, ".github/workflows/quality.yml"), "utf8");
  const triggers = workflow.slice(0, workflow.indexOf("\npermissions:"));
  assert.match(triggers, /pull_request:/);
  assert.match(triggers, /push:\s+branches:\s+- main\s+- ["']codex\/\*\*["']/);
});

test("native repository contracts and providers do not depend on entry-point internals", () => {
  const native = join(root, "apps/desktop/src-tauri/src");
  const main = readFileSync(join(native, "main.rs"), "utf8");
  assert.doesNotMatch(main, /reqwest::|fn repository_\w+|struct RepositoryBindingDto/);
  for (const command of ["connect_provider", "disconnect_provider", "get_account", "list_repositories", "link_workspace", "get_workspace_binding", "get_sync_status", "push_workspace", "pull_workspace", "sync_now"]) {
    assert.ok(main.includes(`repository::repository_${command},`));
  }
  const store = readFileSync(join(native, "cloud_sync_store.rs"), "utf8");
  assert.match(store, /use crate::repository::model::RepositoryBindingDto;/);
  for (const file of ["model.rs", "policy.rs", "provider.rs", "store.rs", "progress.rs"]) {
    const source = readFileSync(join(native, "repository", file), "utf8");
    assert.doesNotMatch(source, /use (?:super|crate)::\*|super::super/);
  }
});

test("native quality produces frontend assets before checking custom-protocol", () => {
  const workflow = readFileSync(join(root, ".github/workflows/quality.yml"), "utf8");
  const native = workflow.slice(workflow.indexOf("  native-tests:"), workflow.indexOf("  desktop-browser:"));
  const install = native.indexOf("run: npm ci");
  const setup = native.indexOf("uses: actions/setup-node@");
  const build = native.indexOf("run: npm --workspace apps/desktop run build");
  const clippy = native.indexOf("run: cargo clippy --all-targets --all-features -- -D warnings");
  assert.ok(install >= 0 && build > install && clippy > build, "The independent native job must build real assets before embedding them");
  assert.ok(setup >= 0 && setup < install);
});

test("release builds frontend assets before all-feature native validation", () => {
  const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
  const native = workflow.slice(workflow.indexOf("  build_macos:"));
  const install = native.indexOf("run: npm ci");
  const build = native.indexOf("run: npm --workspace apps/desktop run build");
  const clippy = native.indexOf("cargo clippy --all-targets --all-features -- -D warnings");
  assert.ok(install >= 0 && build > install && clippy > build,
    "The release job must build frontendDist before direct Cargo embeds custom-protocol assets");
});

test("manual release validation can target a branch without creating a version tag", () => {
  const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
  const input = workflow.slice(workflow.indexOf("      release_tag:"), workflow.indexOf("  push:"));
  assert.match(input, /required: false/);
  assert.match(workflow, /if: env\.RELEASE_TAG != ''/);
});

test("App composes repository workflows and the live editor composes feature extensions", () => {
  const source = join(root, "apps/desktop/src");
  const app = readFileSync(join(source, "App.tsx"), "utf8");
  assert.match(app, /useRepositoryWorkflow\(/);
  assert.doesNotMatch(app, /connectRepositoryProvider|listRepositories\(|getRepositorySyncStatus\(|const \[repositoryDialog/);
  const editor = readFileSync(join(source, "features/editor/components/TyporaLiveEditor.tsx"), "utf8");
  assert.match(editor, /typoraLiveDecorations\(/);
  assert.doesNotMatch(editor, /extends WidgetType|function collectPreviewBlocks|function applyTableEdit|function buildTyporaDecorations/);
  const scanner = readFileSync(join(source, "features/editor/markdown/previewBlocks.ts"), "utf8");
  assert.doesNotMatch(scanner, /from "react"|document\.|window\.|invoke\(|from .*components\//);
});

test("document sessions, zoom resources and table transactions have dedicated owners", () => {
  const source = join(root, "apps/desktop/src");
  const app = readFileSync(join(source, "App.tsx"), "utf8");
  assert.match(app, /useDocumentSession\(/);
  assert.match(app, /useAppZoom\(/);
  assert.doesNotMatch(app, /setDocuments\(|setDocumentRevisions\(|setOpenFileIds\(|setDirtyFileIds\(|zoomRafRef|zoomSettleTimerRef|saveMarkdownFile\(/);
  const table = (file) => readFileSync(join(source, "features/editor/table", file), "utf8");
  assert.doesNotMatch(table("tablePreviewWidget.ts"), /function makeTableCellEditable|function openTableActionMenu|function applyTableEdit|view\.dispatch\(/);
  assert.doesNotMatch(table("tableCellEditing.ts"), /view\.dispatch\(/);
  assert.doesNotMatch(table("tableWidgetMenus.ts"), /view\.dispatch\(/);
  assert.doesNotMatch(table("tableWidgetTransactions.ts"), /document\.querySelector/);
});
