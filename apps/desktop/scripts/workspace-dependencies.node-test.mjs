import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { isBuiltin } from "node:module";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

test("workspaces declare directly imported source dependencies instead of relying on hoisting", () => {
  const missing = [];
  for (const workspace of json(join(root, "package.json")).workspaces) {
    const directory = resolve(root, workspace);
    const pkg = json(join(directory, "package.json"));
    const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    for (const file of readdirSync(join(directory, "src"), { recursive: true })) {
      if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      const source = ts.createSourceFile(file, readFileSync(join(directory, "src", file), "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node) {
        const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
        if (specifier && ts.isStringLiteral(specifier)) {
          const name = specifier.text;
          if (!name.startsWith(".") && !name.startsWith("/") && !isBuiltin(name)) {
            const dependency = name.split("/").slice(0, name.startsWith("@") ? 2 : 1).join("/");
            if (!declared[dependency]) missing.push(`${workspace}/src/${file}: ${dependency}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  assert.deepEqual(missing, []);
});

test("workspace runtime declarations match the lockfile without changing resolved versions", () => {
  const lock = json(join(root, "package-lock.json"));
  for (const workspace of json(join(root, "package.json")).workspaces) {
    assert.deepEqual(lock.packages[workspace].dependencies, json(join(root, workspace, "package.json")).dependencies);
  }
});
