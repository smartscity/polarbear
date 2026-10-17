import type { AppCommand } from "../../shared/commands/appCommandTypes";
import { readUserSettings, updateUserSettings } from "../../shared/settings/userSettings";
import { captionRequest, type CaptionSource } from "./captionAdapter";
import { formatTranscript } from "./transcript";

export async function changeCaptionSource(source: CaptionSource) {
  const status = await captionRequest<"status">({ action: "status" });
  const active = ["starting", "capturing", "paused"].includes(status.state);
  if (active && status.source !== source) {
    // Finish the old transcript before opening a session with a different source.
    await captionRequest({ action: "stop" });
  }
  updateUserSettings({ caption: { ...readUserSettings().caption, source } });
  if (active && status.source !== source && status.state !== "paused") {
    await captionRequest({ action: "start", source, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  }
}

function startCaption() {
  // Native Start serializes activation and reveals an existing session without
  // stopping or resuming it, including repeated menu/shortcut activation.
  return captionRequest({ action: "start", source: readUserSettings().caption.source, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
}

export async function executeCaptionCommand(command: AppCommand, sessionId?: string, format: "txt" | "md" | "srt" = "txt") {
  if (command === "caption.history") return captionRequest({ action: "open", history: true });
  if (command === "caption.start") return startCaption();
  const status = await captionRequest<"status">({ action: "status" });
  if (command === "caption.toggle") {
    return ["starting", "capturing", "paused"].includes(status.state)
      ? captionRequest({ action: "stop" }) : startCaption();
  }
  if (command === "caption.pauseResume") return captionRequest({ action: status.state === "paused" ? "resume" : "pause" });
  if (command === "caption.stop") return captionRequest({ action: "stop" });
  if (command === "caption.export") {
    const id = sessionId ?? status.sessionId;
    if (!id) return;
    const rows = await captionRequest<"snapshot">({ action: "snapshot", id, export: true });
    const result = formatTranscript(rows, readUserSettings().caption, format);
    return captionRequest({ action: "export", text: result.text, format });
  }
  if (command === "caption.copy") {
    const id = sessionId ?? status.sessionId;
    if (!id) return;
    const rows = await captionRequest<"snapshot">({ action: "snapshot", id });
    const result = formatTranscript(rows, readUserSettings().caption);
    if (!result.text) throw new Error("caption.empty");
    await navigator.clipboard.writeText(result.text);
    return result.pending;
  }
}
