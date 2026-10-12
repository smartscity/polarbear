export type ReadingPosition = { anchor: string | null; offset: number; ratio: number; openedAt: number };
export type ReadingSettings = { fontSize: number; lineHeight: number; theme: "system" | "light" | "dark" };
export const DEFAULT_READING_SETTINGS: ReadingSettings = { fontSize: 18, lineHeight: 1.8, theme: "system" };
const KEYS = { settings: "polarbear.reader.settings.v1", positions: "polarbear.reader.positions.v1" };

export function parseReadingSettings(value: Partial<ReadingSettings> | null): ReadingSettings {
  return {
    fontSize: typeof value?.fontSize === "number" && Number.isFinite(value.fontSize) ? Math.max(14, Math.min(28, value.fontSize)) : 18,
    lineHeight: typeof value?.lineHeight === "number" && Number.isFinite(value.lineHeight) ? Math.max(1.4, Math.min(2.2, value.lineHeight)) : 1.8,
    theme: value?.theme === "light" || value?.theme === "dark" ? value.theme : "system",
  };
}
export function readSettings(): ReadingSettings {
  try { return parseReadingSettings(JSON.parse(localStorage.getItem(KEYS.settings) ?? "null")); }
  catch { return DEFAULT_READING_SETTINGS; }
}
export function saveSettings(settings: ReadingSettings): void { localStorage.setItem(KEYS.settings, JSON.stringify(settings)); }
export function readPositions(): Record<string, ReadingPosition> {
  try { const value: unknown = JSON.parse(localStorage.getItem(KEYS.positions) ?? "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, ReadingPosition> : {}; }
  catch { return {}; }
}
export function readPosition(id: string): ReadingPosition | null {
  const p = readPositions()[id];
  return p && Number.isFinite(p.ratio) && Number.isFinite(p.offset) && (p.anchor === null || typeof p.anchor === "string")
    ? { ...p, ratio: Math.max(0, Math.min(1, p.ratio)) } : null;
}
export function savePosition(id: string, position: ReadingPosition): void {
  const recent = Object.entries({ ...readPositions(), [id]: position }).sort(([, a], [, b]) => b.openedAt - a.openedAt).slice(0, 500);
  localStorage.setItem(KEYS.positions, JSON.stringify(Object.fromEntries(recent)));
}
