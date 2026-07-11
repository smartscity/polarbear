export const APP_EVENTS = {
  appCanvasZoomSettled: "polarbear-app-canvas-zoom-settled",
  appZoomChanged: "app-zoom-changed",
  debugChanged: "polarbear-debug-changed",
  nativePinch: "polarbear-native-pinch",
  repositorySyncProgress: "repository-sync-progress",
  settingsChanged: "polarbear-settings-changed"
} as const;

export type AppEventName = typeof APP_EVENTS[keyof typeof APP_EVENTS];
