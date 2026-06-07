import { readFileSync } from "node:fs";

const files = ["apps/desktop/src/App.tsx", "apps/desktop/src/main.tsx"];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  if (/:\s*(?!string\b|number\b|boolean\b|void\b|unknown\b|never\b)[A-Z][A-Za-z0-9_]+/.test(source)) {
    throw new Error(`Unsupported local type annotation pattern in ${file}`);
  }
  if (!source.trim()) {
    throw new Error(`Empty TypeScript source: ${file}`);
  }
}

console.log("TypeScript syntax check passed.");
