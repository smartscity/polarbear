import { MermaidRenderError } from "./mermaidRenderError";
import { ganttDatePolicy, type GanttDatePolicy } from "./ganttDatePolicy";
import { GANTT_LIMITS, ganttDuration, ganttReference, validateGanttSchedule, type GanttTaskSource, type GanttScheduleOptions } from "./ganttScheduleValidation";

const tags = new Set(["active", "done", "crit", "milestone", "vert"]);
function metadata(text: string): string[] {
  const fields = text.split(",").map((field) => field.trim());
  let first = 0;
  while (tags.has(fields[first])) first++;
  return fields.slice(first);
}
function validShape(fields: string[], dates: GanttDatePolicy): boolean {
  if (fields.length < 1 || fields.length > 3 || fields.some((field) => !field)) return false;
  if (fields.length === 3 && /[:,\s]/.test(fields[0])) return false;
  const end = fields.at(-1)!, start = fields.at(-2);
  return (ganttDuration.test(end) || /^until\s/.test(end) && ganttReference.test(end) || dates.parse(end) !== undefined)
    && (!start || dates.parse(start) !== undefined || /^after\s/.test(start) && ganttReference.test(start));
}
function checkConfiguration(text: string, line: number): void {
  // Route tick intervals through the bounded body syntax, including YAML/JSON config.
  if (/\btickInterval\b/.test(text)) throw new MermaidRenderError("syntax", line, "Declare tickInterval in the Gantt body so its work can be validated");
}

/** Adapt only render input. Never return this value to document, clipboard, or persistence state. */
export function prepareGanttSource(source: string): string {
  const lines = source.split("\n");
  let frontmatter = false, directive = false, leading = true, header = -1;
  const configuration: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim();
    if (!text) continue;
    if (leading && text === "---") { frontmatter = true; leading = false; continue; }
    leading = false;
    if (frontmatter) { configuration.push(index); if (text === "---") frontmatter = false; continue; }
    if (text.startsWith("%%{")) directive = true;
    if (directive) { configuration.push(index); if (text.includes("}%%")) directive = false; continue; }
    if (text.startsWith("%%")) continue;
    if (!/^gantt(?:\s*%%.*)?$/i.test(text)) return source;
    header = index; break;
  }
  if (header < 0) return source;
  if (source.length > GANTT_LIMITS.source) throw new MermaidRenderError("limit", undefined, "Gantt source exceeds 50,000 code units");
  configuration.forEach((index) => checkConfiguration(lines[index], index + 1));

  let format = "YYYY-MM-DD", formatLine = header + 1, description = false;
  const taskLines: number[] = [];
  const options: GanttScheduleOptions = { excludes: [], includes: [], weekend: "saturday" };
  for (let index = header + 1; index < lines.length; index++) {
    const text = lines[index].trim();
    if (description) { if (text.includes("}")) description = false; continue; }
    if (/^accDescr\s*\{/i.test(text)) { description = !text.includes("}"); continue; }
    if (text.startsWith("%%{")) directive = true;
    if (directive) { checkConfiguration(text, index + 1); if (text.includes("}%%")) directive = false; continue; }
    if (!text || text.startsWith("%%")) continue;
    const dateFormat = /^dateFormat\s+([^#;]+)/i.exec(text);
    if (dateFormat) { format = dateFormat[1].trim(); formatLine = index + 1; continue; }
    const tick = /^tickInterval\s+([^#;]+)/i.exec(text);
    if (tick) { options.tick = { value: tick[1].trim(), line: index + 1 }; continue; }
    const excludes = /^excludes\s+([^#;]+)/i.exec(text);
    if (excludes) { options.excludes.push(...excludes[1].trim().toLowerCase().split(/[\s,]+/)); continue; }
    const includes = /^includes\s+([^#;]+)/i.exec(text);
    if (includes) { options.includes.push(...includes[1].trim().toLowerCase().split(/[\s,]+/)); continue; }
    const weekend = /^weekend\s+(friday|saturday)\s*$/i.exec(text);
    if (weekend) { options.weekend = weekend[1].toLowerCase(); continue; }
    if (/^inclusiveEndDates\s*$/i.test(text)) { options.inclusiveEndDates = true; continue; }
    if (/^(?:(?:title|section|axisFormat|includes|todayMarker|weekday|click|accDescription)\s|(?:accTitle|accDescr)\s*:|(?:inclusiveEndDates|topAxis)\s*$)/i.test(text)) continue;
    taskLines.push(index);
  }
  // Mermaid compiles tasks after parsing the whole document, using its final dateFormat.
  const dates = ganttDatePolicy(format, formatLine);
  const tasks: GanttTaskSource[] = [];
  if (taskLines.length > GANTT_LIMITS.tasks) throw new MermaidRenderError("limit", taskLines[GANTT_LIMITS.tasks] + 1, "Too many Gantt tasks");
  for (const index of taskLines) {
    const original = lines[index];
    const taskText = original.split("%%", 1)[0].replace(/\r$/, "");
    const positions = [...taskText.matchAll(/:/g)].map((match) => match.index);
    if (!positions.length || positions.length > GANTT_LIMITS.colons) throw new MermaidRenderError("syntax", index + 1, "Missing or ambiguous task delimiter");
    const candidates = positions.filter((position) => validShape(metadata(taskText.slice(position + 1)), dates));
    const separator = candidates[0] === positions[0] ? positions[0] : candidates.length === 1 ? candidates[0] : positions[0];
    if (candidates.length > 1 && candidates[0] !== positions[0]) throw new MermaidRenderError("syntax", index + 1, "Ambiguous task delimiter; use #58; in the label");
    const fields = metadata(taskText.slice(separator + 1));
    if (!taskText.slice(0, separator).trim() || fields.length < 1 || fields.length > 3 || fields.some((field) => !field)
      || fields.length === 3 && /[:,\s]/.test(fields[0])) throw new MermaidRenderError("syntax", index + 1, "Expected optional tags followed by one to three task fields");
    tasks.push({ fields, line: index + 1 });
    lines[index] = original.slice(0, separator).replaceAll(":", "#58;") + original.slice(separator);
  }
  validateGanttSchedule(tasks, dates, options);
  return lines.join("\n");
}
