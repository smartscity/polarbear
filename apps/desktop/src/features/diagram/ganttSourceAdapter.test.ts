import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareGanttSource } from "./ganttSourceAdapter";
import { MermaidRenderError } from "./mermaidRenderError";

const original = readFileSync(new URL("../../../tests/fixtures/gantt-original.mmd", import.meta.url), "utf8");

describe("Gantt render-source boundary", () => {
  it("adapts the untouched reproduction while preserving every metadata suffix", () => {
    const result = prepareGanttSource(original);
    expect(result).toBe(original.replace("14:40 落库", "14#58;40 落库").replace("15:08 再成交", "15#58;08 再成交"));
    expect(prepareGanttSource(result)).toBe(result);
    expect(original).toContain("14:40 落库");
  });
  it.each(["YYYY-MM-DD", "YYYY-MM-DD HH:mm", "YYYY-MM-DD HH:mm:ss"])("preserves timestamps in %s", (format) => {
    const date = "2026-10-19 14:40:32".slice(0, format.length);
    expect(prepareGanttSource(`gantt\ndateFormat ${format}\nClock:14:40:32 :milestone, id, ${date}, 0m`))
      .toBe(`gantt\ndateFormat ${format}\nClock#58;14#58;40#58;32 :milestone, id, ${date}, 0m`);
  });
  it.each(["2026-02-30", "2026-13-01", "not-a-date", "2026-1-1"])("rejects invalid start and end dates: %s", (value) => {
    for (const fields of [`id, ${value}, 1d`, `id, 2026-01-01, ${value}`]) {
      expect(() => prepareGanttSource(`gantt\ndateFormat YYYY-MM-DD\nTask :${fields}`)).toThrow(MermaidRenderError);
      try { prepareGanttSource(`gantt\ndateFormat YYYY-MM-DD\nTask :${fields}`); }
      catch (error) { expect(error).toMatchObject({ kind: "date", line: 3 }); }
    }
  });
  it.each(["2026-10-19 24:00:00", "2026-10-19 23:60:00", "2026-10-19 23:00:60"])("rejects invalid time %s", (date) => {
    expect(() => prepareGanttSource(`gantt\ndateFormat YYYY-MM-DD HH:mm:ss\nTask :a, ${date}, 0m`)).toThrow(MermaidRenderError);
  });
  it("rejects excess fields without passing incomplete task data to Mermaid", () => {
    expect(() => prepareGanttSource("gantt\nTask :id, 2026-10-19, 1d, extra")).toThrow(expect.objectContaining({ kind: "syntax", line: 2 }));
  });
  it("rejects reversed dates and a first task without a start date", () => {
    expect(() => prepareGanttSource("gantt\nTask :a, 2026-10-20, 2026-10-19")).toThrow(MermaidRenderError);
    expect(() => prepareGanttSource("gantt\nTask :1d")).toThrow(MermaidRenderError);
  });
  it("keeps directives, frontmatter, comments, accessibility descriptions, and CRLF intact", () => {
    const source = '---\ntitle: Clock: test\n---\n%%{init: {"theme":"base"}}%%\ngantt\naccTitle: Clock: test\naccDescr {\nClock: 15:08\n}\nsection Clock: 14:40\nA: B :id, 2026-10-19, 1d\n%% Clock: 14:40\n'.replaceAll("\n", "\r\n");
    expect(prepareGanttSource(source)).toBe(source.replace("A: B", "A#58; B"));
  });
  it("preserves native dependency and implicit scheduling syntax", () => {
    const source = "gantt\ndateFormat YYYY-MM-DD\nA :a, 2026-10-19, 1d\nB :b, after a, 1d\nC :2d\nD :d, 2026-10-19, until b";
    expect(prepareGanttSource(source)).toBe(source);
  });
  it.each(["flowchart LR\nA[14:40]-->B", "sequenceDiagram\nA->>B: 14:40", 'pie\n"14:40": 10', "classDiagram\nA : string time", "stateDiagram-v2\nA-->B: next"])("does not transform other diagram syntax", (source) => {
    expect(prepareGanttSource(source)).toBe(source);
  });
  it.each(["DD/MM/YYYY\nTask :a, 19/10/2026, 1d", "HH:mm\nTask :a, 14:40, 1h"])("leaves custom date formats to Mermaid: %s", (body) => {
    const source = `gantt\ndateFormat ${body}`;
    expect(prepareGanttSource(source)).toBe(source);
  });
});

it.each([
  ["DD/MM/YYYY HH:mm", "19/10/2026 14:40"],
  ["YYYY/MM/DD HH:mm:ss", "2026/10/19 14:40:03"],
  ["MMM D, YYYY", "Oct 19, 2026"],
  ["HH:mm", "14:40"],
])("strictly handles custom calendar syntax %s without changing time fields", (format, value) => {
  const source = `gantt\ndateFormat ${format}\nLabel: 14:40 :milestone, a, ${value}, 0m`;
  // Commas are Gantt metadata delimiters even when a date format contains them.
  if (format.includes(",")) expect(() => prepareGanttSource(source)).toThrow(MermaidRenderError);
  else expect(prepareGanttSource(source)).toBe(source.replace("Label: 14:40", "Label#58; 14#58;40"));
});
it("uses Mermaid's final dateFormat and accepts leading whitespace before frontmatter", () => {
  const source = "\n---\ntitle: Example\n---\ngantt\nA: B :a, 19/10/2026, 1d\ndateFormat DD/MM/YYYY";
  expect(prepareGanttSource(source)).toBe(source.replace("A: B", "A#58; B"));
});
it.each([
  "A :a, after missing, 1d",
  "A :a, after b, 1d\nB :b, after a, 1d",
  "A :a, 2026-10-19, 1d\nB :a, 2026-10-20, 1d",
  "A :a, 2026-10-19, until missing",
])("rejects invalid dependency graphs before Mermaid compiles them: %s", (tasks) => {
  expect(() => prepareGanttSource(`gantt\n${tasks}`)).toThrow(expect.objectContaining({ kind: "dependency" }));
});
it("does not silently accept overflowing custom dates or inconsistent epoch-second semantics", () => {
  expect(() => prepareGanttSource("gantt\ndateFormat DD/MM/YYYY\nA :a, 31/02/2026, 1d")).toThrow(expect.objectContaining({ kind: "date" }));
  expect(() => prepareGanttSource("gantt\ndateFormat X\nA :a, 1792368000, 1d")).toThrow(MermaidRenderError);
});
it.each([
  "tickInterval 1millisecond\nA :a, 2026-10-19, 10d",
  "excludes sunday,monday,tuesday,wednesday,thursday,friday,saturday\nA :a, 2026-10-19, 1d",
  "A :a, 2026-10-19, 1000000d",
  "excludes weekends\nA :a, 2026-10-19, 100000d",
  Array.from({ length: 201 }, (_, i) => `A :a${i}, 2026-10-19, 1d`).join("\n"),
])("rejects excessive work before entering the synchronous engine", (body) => {
  expect(() => prepareGanttSource(`gantt\n${body}`)).toThrow(expect.objectContaining({ kind: "limit" }));
});
it("does not allow a config tick interval to bypass body validation", () => {
  expect(() => prepareGanttSource('%%{init: {"gantt": {"tickInterval": "1millisecond"}}}%%\ngantt\nA :a, 2026-10-19, 1d')).toThrow(MermaidRenderError);
});
it("keeps bounded intraday ticks and validates calendar exclusions", () => {
  expect(prepareGanttSource("gantt\ndateFormat HH:mm\ntickInterval 1minute\nA :a, 14:00, 10m")).toContain("14:00, 10m");
  expect(() => prepareGanttSource("gantt\nexcludes 2026-02-30\nA :a, 2026-10-19, 1d")).toThrow(MermaidRenderError);
});

it("rejects upstream calendar combinations that shift declared ends", () => {
  for (const ending of ["until a", "2026-10-26 14:40"]) {
    expect(() => prepareGanttSource(`gantt\ndateFormat YYYY-MM-DD HH:mm\nexcludes weekends\nA :a, 2026-10-23 14:40, 1d\nB :b, 2026-10-23 14:40, ${ending}`)).toThrow(expect.objectContaining({ kind: "calendar", line: 5 }));
  }
});
it("counts inclusive end dates when bounding axis ticks", () => {
  expect(() => prepareGanttSource("gantt\ninclusiveEndDates\ntickInterval 1millisecond\nA :a, 2026-10-19, 2026-10-19")).toThrow(expect.objectContaining({ kind: "limit" }));
});
