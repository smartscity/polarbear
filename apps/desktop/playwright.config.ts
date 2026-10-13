import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser", timeout: 60_000, workers: 1,
  use: { baseURL: "http://127.0.0.1:1422", locale: "en-US", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "npm exec -- vite --host 127.0.0.1 --port 1422 --strictPort", url: "http://127.0.0.1:1422", reuseExistingServer: !process.env.CI },
});
