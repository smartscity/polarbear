import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import advancedFormat from "dayjs/plugin/advancedFormat";
import { MermaidRenderError } from "./mermaidRenderError";

// Match the plugins used by Mermaid's Gantt database, including strict round trips.
dayjs.extend(customParseFormat);
dayjs.extend(advancedFormat);

export function ganttDatePolicy(format: string, line?: number) {
  if (!format || format.length > 128 || format === "X") {
    // Mermaid 11.17.2 treats X start values as milliseconds but end values as seconds.
    throw new MermaidRenderError("date", line, "Use an explicit calendar format or x millisecond timestamps; X has inconsistent upstream semantics");
  }
  const cache = new Map<string, number | undefined>();
  const parse = (value: string): number | undefined => {
    if (cache.has(value)) return cache.get(value);
    const date = dayjs(value, format, true);
    const result = date.isValid() && Math.abs(date.year()) <= 10_000 ? date.valueOf() : undefined;
    cache.set(value, result);
    return result;
  };
  const requireDate = (value: string, sourceLine?: number): number => {
    const date = parse(value);
    if (date === undefined) throw new MermaidRenderError("date", sourceLine, `Expected a valid date matching ${format}: ${value}`);
    return date;
  };
  return { parse, requireDate };
}
export type GanttDatePolicy = ReturnType<typeof ganttDatePolicy>;
