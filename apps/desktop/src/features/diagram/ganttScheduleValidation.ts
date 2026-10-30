import { ganttDatePolicy, type GanttDatePolicy } from "./ganttDatePolicy";
import { MermaidRenderError } from "./mermaidRenderError";

export const GANTT_LIMITS = { source: 50_000, tasks: 200, colons: 128, spanDays: 36_525, calendarSteps: 100_000, ticks: 2_000 } as const;
export const ganttDuration = /^(\d+(?:\.\d+)?)(ms|[Mdhmswy])$/;
export const ganttReference = /^(after|until)\s+([\w-]+(?: +[\w-]+)*)$/;
export type GanttTaskSource = { fields: string[]; line: number };
export type GanttScheduleOptions = { excludes: string[]; includes: string[]; weekend: string; inclusiveEndDates?: boolean; tick?: { value: string; line: number } };
const day = 86_400_000;
const durationUnits: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: day, w: 7 * day, M: 31 * day, y: 366 * day };
const tickUnits: Record<string, number> = { millisecond: 1, second: 1000, minute: 60000, hour: 3600000, day, week: 7 * day, month: 28 * day };
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Validate graph integrity and conservative work bounds, without replacing Mermaid's scheduler. */
export function validateGanttSchedule(tasks: GanttTaskSource[], dates: GanttDatePolicy, options: GanttScheduleOptions): void {
  if (tasks.length > GANTT_LIMITS.tasks) throw new MermaidRenderError("limit", tasks[GANTT_LIMITS.tasks].line, "Too many Gantt tasks");
  let automaticId = 0;
  const ids = tasks.map(({ fields }) => fields.length === 3 ? fields[0] : `task${++automaticId}`);
  const byId = new Map<string, number>();
  const edges: number[][] = [];
  const explicit: number[] = [];
  let durations = 0;
  tasks.forEach(({ fields, line }, index) => {
    if (byId.has(ids[index]) || ["__proto__", "constructor", "prototype"].includes(ids[index])) {
      throw new MermaidRenderError("dependency", line, "Duplicate or reserved task ID");
    }
    byId.set(ids[index], index);
    const start = fields.length > 1 ? fields.at(-2) : undefined;
    const end = fields.at(-1)!;
    // Upstream only recognizes YYYY-MM-DD as a manual end when applying exclusions.
    // Other explicit formats and until can be extended past their declared end.
    if (options.excludes.length && !ganttDuration.test(end) && !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      throw new MermaidRenderError("calendar", line, "Exclusions require a duration or a YYYY-MM-DD end date");
    }
    if (!start && index === 0) throw new MermaidRenderError("date", line, "The first task needs an explicit start date");
    if (start && !(ganttReference.exec(start)?.[1] === "after")) explicit.push(dates.requireDate(start, line));
    const duration = ganttDuration.exec(end);
    if (duration) {
      const value = Number(duration[1]) * durationUnits[duration[2]];
      if (!Number.isFinite(value)) throw new MermaidRenderError("limit", line, "Duration is not finite");
      durations += value;
    } else if (!(ganttReference.exec(end)?.[1] === "until")) {
      const finish = dates.requireDate(end, line);
      explicit.push(finish);
      if (start && dates.parse(start) !== undefined && finish < dates.parse(start)!) throw new MermaidRenderError("date", line, "End precedes start");
    }
  });
  tasks.forEach(({ fields, line }, index) => {
    const dependencies: number[] = fields.length === 1 ? [index - 1] : [];
    for (const field of fields.slice(fields.length === 3 ? 1 : 0)) {
      const match = ganttReference.exec(field);
      if (!match) continue;
      for (const id of match[2].split(/\s+/)) {
        const target = byId.get(id);
        if (target === undefined) throw new MermaidRenderError("dependency", line, `Unknown task: ${id}`);
        dependencies.push(target);
      }
    }
    edges.push(dependencies);
  });
  const visiting = new Set<number>(), visited = new Map<number, number>();
  const visit = (index: number): number => {
    if (visiting.has(index)) throw new MermaidRenderError("dependency", tasks[index].line, "Cyclic task dependency");
    if (visited.has(index)) return visited.get(index)!;
    visiting.add(index);
    const passes = Math.max(0, ...edges[index].map((target) => visit(target) + Number(target > index)));
    if (passes > 10) throw new MermaidRenderError("dependency", tasks[index].line, "Dependency order exceeds Mermaid's resolution passes");
    visiting.delete(index); visited.set(index, passes); return passes;
  };
  tasks.forEach((_, index) => visit(index));

  const excluded = new Set(options.excludes);
  if (excluded.has("weekends")) {
    const start = options.weekend === "friday" ? 5 : 6;
    excluded.add(weekdays[start]); excluded.add(weekdays[(start + 1) % 7]);
  }
  if (weekdays.every((name) => excluded.has(name))) throw new MermaidRenderError("limit", undefined, "Every weekday is excluded");
  const calendarDates = ganttDatePolicy("YYYY-MM-DD");
  for (const value of [...excluded, ...options.includes]) {
    if (excluded.has(value) && (weekdays.includes(value) || value === "weekends")) continue;
    if (calendarDates.parse(value) === undefined && dates.parse(value) === undefined) {
      throw new MermaidRenderError("date", undefined, `Invalid calendar inclusion or exclusion: ${value}`);
    }
  }
  // Recurring exclusions can stretch work by at most seven days per working day.
  // Absolute exclusions add at most one day each. Conservative rejection is explicit.
  const span = (explicit.length ? Math.max(...explicit) - Math.min(...explicit) : 0) + durations + (options.inclusiveEndDates ? tasks.length * day : 0);
  const upperDays = Math.ceil(span / day) * (excluded.size ? 7 : 1) + excluded.size;
  if (upperDays > GANTT_LIMITS.spanDays || excluded.size && (upperDays * tasks.length > GANTT_LIMITS.calendarSteps || upperDays - Math.ceil(span / day) >= 10_000)) {
    throw new MermaidRenderError("limit", undefined, "Timeline exceeds the local rendering work budget");
  }
  if (options.tick) {
    const match = /^(\d+)(millisecond|second|minute|hour|day|week|month)$/.exec(options.tick.value);
    if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) throw new MermaidRenderError("syntax", options.tick.line, "Invalid tickInterval");
    const interval = Number(match[1]) * tickUnits[match[2]];
    // With no exclusions, retain sub-day precision so short intraday charts remain useful.
    const extent = excluded.size ? upperDays * day : span;
    if (extent / interval > GANTT_LIMITS.ticks) throw new MermaidRenderError("limit", options.tick.line, "Too many axis ticks");
  }
}
