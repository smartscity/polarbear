import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const root = fileURLToPath(new URL("../../../", import.meta.url));

export function cyclesIn(graph) {
  const active = new Set(), visited = new Set(), stack = [], cycles = [];
  function visit(node) {
    if (active.has(node)) { cycles.push([...stack.slice(stack.indexOf(node)), node]); return; }
    if (visited.has(node)) return;
    visited.add(node); active.add(node); stack.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    stack.pop(); active.delete(node);
  }
  for (const node of graph.keys()) visit(node);
  return cycles;
}

export function auditArchitecture() {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const added = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const files = [...new Set([...tracked, ...added])];
  const sourceFiles = files.filter((file) => /^(apps\/(desktop|ios)\/src|packages\/[^/]+\/src)\//.test(file)
    && /\.tsx?$/.test(file) && !/\.(test|spec)\.|\/generated\//.test(file));
  const sources = new Set(sourceFiles.map((file) => resolve(root, file)));
  const graph = new Map(sourceFiles.map((file) => [file, []]));
  const edges = [], functions = [], unresolved = [], computedImports = [];
  for (const file of sourceFiles) {
    const source = ts.createSourceFile(file, readFileSync(resolve(root, file), "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isFunctionLike(node) && node.body) {
        const start = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const end = source.getLineAndCharacterOfPosition(node.end).line + 1;
        functions.push({ file, line: start, lines: end - start + 1, name: node.name?.getText(source) ?? node.parent?.name?.getText(source) ?? "anonymous" });
      }
      const dynamic = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier : dynamic ? node.arguments[0] : undefined;
      if (dynamic && specifier && !ts.isStringLiteral(specifier)) computedImports.push(file);
      if (specifier && ts.isStringLiteral(specifier)) {
        const value = specifier.text;
        let target;
        if (value.startsWith(".")) {
          const base = resolve(root, dirname(file), value);
          target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((path) => sources.has(path));
          if (!target && !/\.(css|json|svg|png|properties)(\?|$)/.test(value) && !value.includes("/generated/")) unresolved.push({ file, specifier: value });
        } else if (value === "@polarbear/reader-core") target = resolve(root, "packages/reader-core/src/index.ts");
        if (target && sources.has(target)) {
          const to = relative(root, target);
          const bindings = node.importClause?.namedBindings;
          const typeOnly = node.isTypeOnly || node.importClause?.isTypeOnly ||
            (bindings && ts.isNamedImports(bindings) && !node.importClause.name && bindings.elements.length > 0 && bindings.elements.every((item) => item.isTypeOnly));
          edges.push({ from: file, to, typeOnly: Boolean(typeOnly) });
          if (!typeOnly) graph.get(file).push(to);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const forbidden = edges.filter(({ from, to }) =>
    (/\/src\/shared\//.test(from) && /\/src\/(features|app)\/|\/src\/App\.tsx$/.test(to)) ||
    (/\/src\/features\//.test(from) && /\/src\/app\/|\/src\/App\.tsx$/.test(to)));
  const crossFeature = edges.filter(({ from, to }) => {
    const a = from.match(/\/features\/([^/]+)\//)?.[1];
    const b = to.match(/\/features\/([^/]+)\//)?.[1];
    return a && b && a !== b;
  });
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    trackedFiles: tracked.length, untrackedFiles: added.length, productionTypeScriptFiles: sourceFiles.length,
    runtimeCycles: cyclesIn(graph), forbidden, unresolved, computedImports,
    crossFeature, largestFunctions: functions.sort((a, b) => b.lines - a.lines).slice(0, 15),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(auditArchitecture(), null, 2));
}
