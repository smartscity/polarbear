type ModifierEvent = Pick<KeyboardEvent | WheelEvent, "ctrlKey" | "metaKey">;

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { platform?: string };
};

/**
 * Treat Command as the primary modifier on Apple platforms and Control as the
 * primary modifier elsewhere. Browser events expose both flags, which keeps
 * this adapter usable for external keyboards on tablets as well.
 */
export function hasPrimaryModifier(event: ModifierEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

/**
 * Presents registry accelerators using the modifier names familiar on the
 * current device. Execution remains platform-neutral through CmdOrCtrl.
 */
export function displayAccelerator(accelerator: string | undefined): string {
  if (!accelerator) {
    return "";
  }

  const isApplePlatform = currentPlatformHint().match(/mac|iphone|ipad|ipod/i);
  return accelerator
    .replace("CmdOrCtrl", isApplePlatform ? "Command" : "Control")
    .replace("Alt", isApplePlatform ? "Option" : "Alt");
}

function currentPlatformHint(): string {
  if (typeof navigator === "undefined") {
    return "";
  }

  const browserNavigator = navigator as NavigatorWithUserAgentData;
  return browserNavigator.userAgentData?.platform
    ?? navigator.platform
    ?? navigator.userAgent;
}
