import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({ ...base, testDir: "tests/performance", testMatch: "gantt.spec.ts", workers: 1, use: { ...base.use, browserName: "chromium", viewport: { width: 1280, height: 800 } } });
