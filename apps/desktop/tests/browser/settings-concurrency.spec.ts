import { expect, test } from "@playwright/test";
import { nativeFixture } from "./fixtures/native";

test("hydrates committed preferences before mounting a newly opened window", async ({ page, context }) => {
  await nativeFixture(page); await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/shared/settings/userSettings.ts";
    const settings = await import(path);
    await settings.updateUserSettings({ theme: "dark", layout: { leftWidth: 320 } });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("polarbear.settings", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("preferences", "readwrite");
        let held = true;
        (window as any).__releaseHydration = () => { held = false; };
        const keepAlive = () => {
          const read = tx.objectStore("preferences").get("polarbear.settings");
          read.onsuccess = () => { if (held) keepAlive(); };
        };
        keepAlive();
        tx.oncomplete = () => open.result.close();
        resolve();
      };
    });
  });
  const other = await context.newPage();
  await nativeFixture(other);
  await other.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      (window as any).__settingsOpened = true;
      return open.apply(this, args);
    };
  });
  try {
    await other.goto("/");
    await other.waitForFunction(() => (window as any).__settingsOpened);
    await expect(other.locator(".app-shell")).toHaveCount(0);
  } finally {
    await page.evaluate(() => (window as any).__releaseHydration());
  }
  await expect(other.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "320");
  await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("serializes settings intent across windows and reloads the merged snapshot", async ({ page, context }) => {
  await nativeFixture(page);
  await page.goto("/");
  const other = await context.newPage();
  await nativeFixture(other);
  await other.goto("/");
  // Hold the real origin-scoped lock; both writers must wait without writing stale snapshots.
  await page.evaluate(async () => {
    const path = "/src/shared/constants/storageKeys.ts";
    const { STORAGE_KEYS } = await import(path);
    await new Promise<void>(resolve => {
      void navigator.locks.request(STORAGE_KEYS.settings, async () => {
        await new Promise<void>(release => { (window as any).__releaseSettings = release; resolve(); });
      });
    });
  });
  await page.evaluate(async () => {
    const path = "/src/shared/settings/userSettings.ts";
    const { updateUserSettings } = await import(path);
    (window as any).__settingsWrite = updateUserSettings({ caption: { source: "microphone" }, layout: { leftWidth: 320 }, keybindings: { "file.save": "Mod+Alt+S" } });
  });
  await other.evaluate(async () => {
    const path = "/src/shared/settings/userSettings.ts";
    const { updateUserSettings } = await import(path);
    (window as any).__settingsWrite = updateUserSettings({ caption: { showChinese: true }, layout: { rightOpen: true }, keybindings: { "caption.start": null } });
  });
  expect(await other.evaluate(() => localStorage.getItem("polarbear.settings"))).toBeNull();
  await page.evaluate(async () => { (window as any).__releaseSettings(); await (window as any).__settingsWrite; });
  await other.evaluate(async () => { await (window as any).__settingsWrite; });
  for (const tab of [page, other]) {
    await expect.poll(() => tab.evaluate(async () => {
      const path = "/src/shared/settings/userSettings.ts";
      return (await import(path)).readUserSettings();
    })).toMatchObject({
      caption: { source: "microphone", showChinese: true }, layout: { leftWidth: 320, rightOpen: true },
      keybindings: { "file.save": "Mod+Alt+S", "caption.start": null },
    });
    await expect(tab.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "320");
    await tab.reload();
    await expect(tab.locator("#workspace-outline")).toHaveAttribute("aria-hidden", "false");
    await expect(tab.locator(".workspace-separator.left")).toHaveAttribute("aria-valuenow", "320");
  }
});

test("imports legacy preferences once and rejects a failed database write without acknowledging it", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    localStorage.setItem("polarbear.settings", JSON.stringify({ version: 4, theme: "dark", caption: { source: "microphone", showChinese: true }, layout: { leftWidth: 320 } }));
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/shared/settings/userSettings.ts";
    const settings = await import(path);
    await settings.initializeUserSettings();
    await settings.updateUserSettings({ theme: "light" });
    IDBObjectStore.prototype.put = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: "Selection translation", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Selection translation", exact: true })).toBeChecked();
  await page.reload();
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/shared/settings/userSettings.ts";
    const settings = await import(path);
    await settings.initializeUserSettings();
    return settings.readUserSettings();
  })).toMatchObject({ theme: "light", selectionTranslation: true, caption: { source: "microphone", showChinese: true }, layout: { leftWidth: 320 } });
});

test("reports lock timeout without writing and recovers after the holding window closes", async ({ page, context }) => {
  await nativeFixture(page); await page.goto("/");
  const holder = await context.newPage();
  await nativeFixture(holder); await holder.goto("/");
  await holder.evaluate(async () => {
    await new Promise<void>(resolve => {
      void navigator.locks.request("polarbear.settings", () => {
        resolve(); return new Promise<void>(() => {});
      });
    });
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Selection translation", exact: true });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible({ timeout: 8_000 });
  await expect(toggle).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("polarbear.settings"))).toBeNull();
  await holder.close();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Selection translation", exact: true })).not.toBeChecked();
});
