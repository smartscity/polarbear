export const APP_EVENTS = {
  appCanvasZoomSettled: "polarbear-app-canvas-zoom-settled",
  appZoomChanged: "app-zoom-changed",
  debugChanged: "polarbear-debug-changed",
  nativePinch: "polarbear-native-pinch",
  nativeFullscreenRestored: "polarbear-native-fullscreen-restored",
  openFilesRequested: "polarbear-open-files-requested",
  repositorySyncProgress: "repository-sync-progress",
  settingsChanged: "polarbear-settings-changed",
  recentDocumentsChanged: "polarbear-recent-documents-changed",
  windowCloseRequested: "polarbear-window-close-requested",
} as const;

export type AppEventName = typeof APP_EVENTS[keyof typeof APP_EVENTS];
