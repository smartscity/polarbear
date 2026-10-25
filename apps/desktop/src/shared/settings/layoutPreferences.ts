export const LAYOUT_LIMITS = {
  defaultWidth: 240, minWidth: 180, leftMax: 420, rightMax: 400,
  separator: 6, editorMin: 360, splitEditorMin: 640, step: 8, largeStep: 32,
} as const;

export type LayoutPreferences = {
  leftWidth: number; rightWidth: number; leftOpen: boolean; rightOpen: boolean;
};
export const DEFAULT_LAYOUT: LayoutPreferences = {
  leftWidth: LAYOUT_LIMITS.defaultWidth, rightWidth: LAYOUT_LIMITS.defaultWidth,
  leftOpen: true, rightOpen: false,
};

export function parseLayoutPreferences(value: unknown): LayoutPreferences {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const width = (value: unknown, max: number) => typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(LAYOUT_LIMITS.minWidth, Math.min(max, value))) : LAYOUT_LIMITS.defaultWidth;
  return { leftWidth: width(data.leftWidth, LAYOUT_LIMITS.leftMax), rightWidth: width(data.rightWidth, LAYOUT_LIMITS.rightMax),
    leftOpen: typeof data.leftOpen === "boolean" ? data.leftOpen : DEFAULT_LAYOUT.leftOpen,
    rightOpen: typeof data.rightOpen === "boolean" ? data.rightOpen : DEFAULT_LAYOUT.rightOpen };
}
