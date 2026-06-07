import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("apps/desktop/dist", { recursive: true });

const html = readFileSync("apps/desktop/index.html", "utf8").replace(
  "/src/main.tsx",
  "./main.js",
);
const appSource = readFileSync("apps/desktop/src/App.tsx", "utf8")
  .replace(/export /g, "")
  .replace(/: string/g, "");
const mainSource = readFileSync("apps/desktop/src/main.tsx", "utf8").replace(
  /import[\s\S]*?from "\.\/App";/,
  "",
);

writeFileSync("apps/desktop/dist/index.html", html);
writeFileSync("apps/desktop/dist/main.js", `${appSource}\n${mainSource}`);
copyFileSync("apps/desktop/package.json", "apps/desktop/dist/package.json");

console.log("Desktop build written to apps/desktop/dist.");
