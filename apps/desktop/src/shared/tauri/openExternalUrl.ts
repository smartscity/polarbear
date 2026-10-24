import { isTauri } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { translateCurrent } from "../i18n/translate";
import { TAURI_COMMANDS } from "./commandIds";
import { invokeTauri } from "./invokeTauri";

/** UI action: report failures without navigating away from unsaved documents. */
export async function openExternalUrl(url: string): Promise<void> {
  const native = isTauri();
  let target: URL;
  try {
    target = new URL(url);
    if (!/^https?:\/\//i.test(url) || !target.hostname || target.username || target.password
      || [...url].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "\\")) {
      throw new Error("Invalid external URL");
    }
  } catch {
    await reportFailure("externalUrl.invalid", native);
    return;
  }

  try {
    if (native) {
      await invokeTauri(TAURI_COMMANDS.openExternalUrl, { url: target.href });
    } else {
      // noopener may return null even when opening succeeds. Never navigate this window.
      window.open(target.href, "_blank", "noopener,noreferrer");
    }
  } catch {
    await reportFailure("externalUrl.openFailed", native);
  }
}

async function reportFailure(key: "externalUrl.invalid" | "externalUrl.openFailed", native: boolean): Promise<void> {
  const text = translateCurrent(key);
  if (native) {
    try {
      await message(text, { title: translateCurrent("externalUrl.title"), kind: "error" });
      return;
    } catch {
      // Dialog transport can fail independently from the launcher.
    }
  }
  window.alert(text);
}
