import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:1430", viewport: { width: 390, height: 844 }, locale: "en-US", screenshot: "only-on-failure" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:1430", reuseExistingServer: !process.env.CI },
});
