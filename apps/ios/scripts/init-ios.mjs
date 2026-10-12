import { copyFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const app = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const result = spawnSync("tauri", ["ios", "init", ...args], { cwd: app, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (!args.includes("--help") && !args.includes("-h")) {
  const source = resolve(app, "../desktop/src-tauri/icons/ios");
  const target = resolve(app, "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset");
  for (const name of readdirSync(source).filter((name) => name.endsWith(".png"))) {
    copyFileSync(resolve(source, name), resolve(target, name));
  }
}
