import { readFileSync } from "node:fs";

const files = [
  "README.md",
  "ARCHITECTURE.md",
  "Cargo.toml",
  "apps/desktop/package.json",
  "apps/desktop/index.html",
  "apps/desktop/src/App.tsx",
];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const legacyName = ["mark", "flow"].join("");
  const legacyTitle = `${legacyName[0].toUpperCase()}${legacyName.slice(1)}`;
  const legacyConstant = legacyName.toUpperCase();
  if (content.includes(legacyName) || content.includes(legacyTitle) || content.includes(legacyConstant)) {
    throw new Error(`Legacy source branding found in ${file}`);
  }
}

const app = readFileSync("apps/desktop/src/App.tsx", "utf8");
const requiredPhrases = [
  "Polarbear",
  "A local-first Markdown editor for writers, developers, and GitHub-based knowledge workflows.",
  "Local-first Writing",
  "Mermaid Diagrams",
  "GitHub Workflow",
  "Polarbear uses plugins to keep core editing, diagram rendering, repository sync, and export capabilities clearly separated.",
  "Your GitHub token must never be printed in logs or stored in plain text.",
];

for (const phrase of requiredPhrases) {
  if (!app.includes(phrase)) {
    throw new Error(`Missing required frontend phrase: ${phrase}`);
  }
}

console.log("Frontend content check passed.");
