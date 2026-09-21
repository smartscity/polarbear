export const APP_EVENTS = {
  appCanvasZoomSettled: "polarbear-app-canvas-zoom-settled",
  appZoomChanged: "app-zoom-changed",
  debugChanged: "polarbear-debug-changed",
  nativePinch: "polarbear-native-pinch",
  openFilesRequested: "polarbear-open-files-requested",
  repositorySyncProgress: "repository-sync-progress",
  settingsChanged: "polarbear-settings-changed",
  windowCloseRequested: "polarbear-window-close-requested",
} as const;

export type AppEventName = typeof APP_EVENTS[keyof typeof APP_EVENTS];
