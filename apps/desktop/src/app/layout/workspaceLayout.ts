import { LAYOUT_LIMITS as L, type LayoutPreferences } from "../../shared/settings/layoutPreferences";

export type SidebarSide = "left" | "right";
export type EffectiveLayout = { left: number; right: number; center: number };

/** Compress preferences, then hide right before left. Never mutate persisted preferences. */
export function resolveWorkspaceLayout(width: number, prefs: LayoutPreferences, split: boolean): EffectiveLayout {
  width = Math.max(0, width);
  const centerMin = split ? L.splitEditorMin : L.editorMin;
  let left = prefs.leftOpen ? prefs.leftWidth : 0;
  let right = prefs.rightOpen ? prefs.rightWidth : 0;
  const total = () => left + right + (left ? L.separator : 0) + (right ? L.separator : 0);
  let excess = Math.max(0, total() + centerMin - width);
  const rightShrink = Math.min(excess, Math.max(0, right - L.minWidth));
  right -= rightShrink; excess -= rightShrink;
  const leftShrink = Math.min(excess, Math.max(0, left - L.minWidth));
  left -= leftShrink;
  if (total() + centerMin > width) right = 0;
  if (total() + centerMin > width) left = 0;
  return { left, right, center: Math.max(0, width - total()) };
}

export function maximumSidebarWidth(side: SidebarSide, width: number, layout: EffectiveLayout, split: boolean) {
  const other = side === "left" ? layout.right : layout.left;
  return Math.max(L.minWidth, Math.min(side === "left" ? L.leftMax : L.rightMax,
    width - (split ? L.splitEditorMin : L.editorMin) - L.separator - other - (other ? L.separator : 0)));
}
