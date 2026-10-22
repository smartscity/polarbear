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
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEYS.positions) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([id, record]) => {
      const position = parsePosition(record);
      return position ? [[id, position]] : [];
    }));
  }
  catch { return {}; }
}
export function readPosition(id: string): ReadingPosition | null {
  const positions = readPositions();
  return Object.hasOwn(positions, id) ? positions[id] : null;
}

function parsePosition(value: unknown): ReadingPosition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Partial<ReadingPosition>;
  if (typeof p.ratio !== "number" || !Number.isFinite(p.ratio)
    || typeof p.offset !== "number" || !Number.isFinite(p.offset)
    || typeof p.openedAt !== "number" || !Number.isFinite(p.openedAt) || p.openedAt < 0
    || (p.anchor !== null && typeof p.anchor !== "string")) return null;
  return { anchor: p.anchor, ratio: Math.max(0, Math.min(1, p.ratio)), offset: Math.max(0, p.offset), openedAt: p.openedAt };
}
export function savePosition(id: string, position: ReadingPosition): void {
  const recent = Object.entries({ ...readPositions(), [id]: position }).sort(([, a], [, b]) => b.openedAt - a.openedAt).slice(0, 500);
  localStorage.setItem(KEYS.positions, JSON.stringify(Object.fromEntries(recent)));
}
