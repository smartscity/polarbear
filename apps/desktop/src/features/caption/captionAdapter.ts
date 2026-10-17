import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { invokeTauri } from "../../shared/tauri/invokeTauri";

export type CaptionSource = "system" | "microphone";
export type CaptionStatus = { sessionId: string | null; state: string; source: string; partial: string; error: string | null; elapsedMs: number; audioLevel: number; viewRevision: number; historyRequested: boolean };
export type CaptionSession = { id: string; title: string; place: string; startedAt: number; endedAt: number | null; source: string; status: string; count: number; timeZone: string };
export type CaptionSegment = { id: number; sessionId: string; startMs: number; endMs: number; english: string; chinese: string | null; translationStatus: string };
export type TranslationJob = { id: number; lease: string; english: string };

type Requests = {
  status: { request: { action: "status" }; response: CaptionStatus };
  open: { request: { action: "open"; history: boolean }; response: void };
  start: { request: { action: "start"; source: CaptionSource; timezone: string }; response: void };
  pause: { request: { action: "pause" }; response: void };
  resume: { request: { action: "resume" }; response: void };
  stop: { request: { action: "stop" }; response: void };
  list: { request: { action: "list"; query: string; offset: number }; response: CaptionSession[] };
  segments: { request: { action: "segments"; id: string; after: number }; response: CaptionSegment[] };
  tail: { request: { action: "tail"; id: string }; response: CaptionSegment[] };
  snapshot: { request: { action: "snapshot"; id: string; export?: boolean }; response: CaptionSegment[] };
  export: { request: { action: "export"; text: string; format: "txt" | "md" | "srt" }; response: boolean };
  rename: { request: { action: "rename"; id: string; title: string; place: string }; response: void };
  delete: { request: { action: "delete"; id: string }; response: void };
  retry: { request: { action: "retry"; id: string }; response: void };
  pin: { request: { action: "pin"; pinned: boolean }; response: void };
  claim: { request: { action: "claim" }; response: TranslationJob | null };
  complete: { request: { action: "complete"; id: number; lease: string; chinese: string | null }; response: void };
};
export function captionRequest<K extends keyof Requests>(request: Requests[K]["request"]): Promise<Requests[K]["response"]> {
  return invokeTauri(TAURI_COMMANDS.captionRequest, { request });
}
