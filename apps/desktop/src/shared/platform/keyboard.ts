type ModifierEvent = Pick<KeyboardEvent | WheelEvent, "ctrlKey" | "metaKey">;

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { platform?: string };
};

/**
 * Treat Command as the primary modifier on Apple platforms and Control as the
 * primary modifier elsewhere. This is intentionally separate from zoom: macOS
 * trackpad pinch commonly arrives as Ctrl+wheel even though Command is the
 * keyboard primary modifier.
 */
export function hasPrimaryModifier(
  event: ModifierEvent,
  platformHint = currentPlatformHint(),
): boolean {
  return isApplePlatform(platformHint) ? event.metaKey : event.ctrlKey;
}

/**
 * Zoom gestures can be initiated by either Command/Control wheel or browser
 * pinch emulation. Keep this broader than the keyboard command modifier.
 */
export function hasZoomModifier(event: ModifierEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function isApplePlatform(platformHint = currentPlatformHint()): boolean {
  return /mac|iphone|ipad|ipod/i.test(platformHint);
}

/**
 * Presents registry accelerators using the modifier names familiar on the
 * current device. Execution remains platform-neutral through CmdOrCtrl.
 */
export function displayAccelerator(accelerator: string | undefined, options: { symbols?: boolean; platformHint?: string } = {}): string {
  if (!accelerator) {
    return "";
  }

  const isApple = isApplePlatform(options.platformHint);
  if (isApple && options.symbols) {
    const symbols: Record<string, string> = { CmdOrCtrl: "\u2318", Command: "\u2318", Cmd: "\u2318", Meta: "\u2318", Alt: "\u2325", Option: "\u2325", Shift: "\u21e7", Control: "\u2303", Ctrl: "\u2303" };
    return accelerator.split("+").map((key) => symbols[key] ?? key).join("");
  }
  return accelerator
    .replace("CmdOrCtrl", isApple ? "Command" : "Control")
    .replace("Alt", isApple ? "Option" : "Alt");
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
