import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  await page.addInitScript(() => {
    const reads: { workspace: string; resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
    Object.assign(window, { __identityReads: reads, __TAURI_INTERNALS__: {
      invoke: async (command: string, args: { workspaceRef?: string }) => {
        if (command === "repository_get_account") return { provider: "github", login: "fixture" };
        if (command === "repository_get_workspace_binding") return new Promise((resolve, reject) => reads.push({ workspace: args.workspaceRef!, resolve, reject }));
        return null;
      },
    } });
  });
  await page.goto("/tests/browser/navigation.html?repository");
  await expect.poll(() => page.evaluate(() => (window as any).__identityReads.length)).toBe(1);
}

test("discards repository responses and errors from the previous workspace", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => (window as any).__selectWorkspace("/test/other"));
  await expect.poll(() => page.evaluate(() => (window as any).__identityReads.length)).toBe(2);
  await page.evaluate(() => (window as any).__identityReads[1].resolve({ workspaceRef: "/test/other", repo: "new" }));
  await expect(page.locator("output")).toContainText('"repo":"new"');
  await page.evaluate(() => (window as any).__identityReads[0].reject(new Error("obsolete failure")));
  await expect(page.locator("output")).not.toContainText("obsolete failure");
  await expect(page.locator("output")).toContainText('"repo":"new"');
});

test("does not resurrect credentials after disconnecting during a refresh", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__repositoryIdentity.setRepositoryAccount(null);
    w.__repositoryIdentity.setRepositoryBinding(null);
    w.__identityReads[0].resolve({ workspaceRef: "/test/project", repo: "stale" });
  });
  await expect(page.locator("output")).toContainText('"account":null,"binding":null');
});

test("clears the visible binding immediately and rejects an old A to B to A completion", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => (window as any).__selectWorkspace("/test/other"));
  await expect.poll(() => page.evaluate(() => (window as any).__identityReads.length)).toBe(2);
  await page.evaluate(() => (window as any).__identityReads[1].resolve({ workspaceRef: "/test/other", repo: "other" }));
  await expect(page.locator("output")).toContainText('"repo":"other"');
  await page.evaluate(() => (window as any).__selectWorkspace("/test/project"));
  await expect.poll(() => page.evaluate(() => (window as any).__identityReads.length)).toBe(3);
  await expect(page.locator("output")).toContainText('"binding":null');
  await page.evaluate(() => (window as any).__identityReads[0].resolve({ workspaceRef: "/test/project", repo: "obsolete" }));
  await page.evaluate(() => (window as any).__identityReads[2].resolve({ workspaceRef: "/test/project", repo: "current" }));
  await expect(page.locator("output")).toContainText('"repo":"current"');
});

test("reports a current repository refresh failure", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => (window as any).__identityReads[0].reject(new Error("current failure")));
  await expect(page.locator("output")).toContainText("current failure");
});

test("restores pending cleanup after reload and keeps authentication unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI_INTERNALS__: {
      invoke: async (command: string) => {
        if (command === "repository_get_account") throw JSON.stringify({
          code: "repository.secretDeletionFailed", message: "private diagnostic",
        });
        return null;
      },
    } });
  });
  await page.goto("/tests/browser/navigation.html?repository");
  const pending = () => page.evaluate(() => (window as any).__repositoryIdentity?.repositoryCleanupPending);
  await expect.poll(pending).toBe(true);
  await expect(page.locator("output")).toContainText('"account":null,"binding":null');
  await expect(page.locator("output")).not.toContainText("private diagnostic");
  await page.reload();
  await expect.poll(pending).toBe(true);
  await page.evaluate(() => (window as any).__repositoryIdentity.setRepositoryAccount(null));
  await expect.poll(pending).toBe(false);
});
