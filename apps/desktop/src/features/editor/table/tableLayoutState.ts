import { invertedEffects } from "@codemirror/commands";
import { Facet, StateEffect, StateField, type EditorState, type Extension, type Transaction } from "@codemirror/state";
import { TABLE_COMMANDS, type TableCommandContext, type TableCommandId } from "./tableCommands";
import { parseMarkdownTable } from "./tableModel";

const documentIdentity = Facet.define<string, string>({ combine: (values) => values[0] ?? "" });
type WidthChange = { generation: symbol; from: number; widths: readonly number[] };
const changeWidths = StateEffect.define<WidthChange>({
  map: (value, changes) => ({ ...value, from: changes.mapPos(value.from, -1) }),
});
type Layout = ReadonlyMap<number, readonly number[]>;

function columnCount(state: EditorState, from: number): number {
  if (from < 0 || from > state.doc.length) return 0;
  const line = state.doc.lineAt(from);
  if (line.from !== from || line.number === state.doc.lines) return 0;
  return parseMarkdownTable(`${line.text}\n${state.doc.line(line.number + 1).text}`)?.header.length ?? 0;
}

function mapTableStart(transaction: Transaction, from: number): number | null {
  let removed = false;
  let replaced = false;
  transaction.changes.iterChanges((start, end, _newStart, _newEnd, inserted) => {
    if (start <= from && end > from) {
      replaced = start === from && inserted.length > 0;
      removed = !replaced;
    }
  });
  return removed ? null : transaction.changes.mapPos(from, replaced ? -1 : 1);
}

function updateLayout(previous: Layout, transaction: Transaction, generation: symbol): Layout {
  if (!transaction.docChanged && !transaction.effects.some((effect) => effect.is(changeWidths))) return previous;
  const next = new Map<number, readonly number[]>();
  const set = (from: number, widths: readonly number[]) => {
    const count = columnCount(transaction.state, from);
    const normalized = Array.from({ length: count }, (_, column) => {
      const width = widths[column] ?? 0;
      return Number.isFinite(width) && width > 0 ? width : 0;
    });
    if (normalized.some(Boolean)) next.set(from, normalized);
    else next.delete(from);
  };
  for (const [from, widths] of previous) {
    const mapped = mapTableStart(transaction, from);
    if (mapped !== null) set(mapped, widths);
  }
  for (const effect of transaction.effects) {
    if (effect.is(changeWidths) && effect.value.generation === generation) set(effect.value.from, effect.value.widths);
  }
  return next;
}

const freshLayout = () => ({ generation: Symbol("table-layout-session"), widths: new Map() as Layout });
const layoutField = StateField.define<ReturnType<typeof freshLayout>>({
  create: freshLayout,
  update: (previous, transaction) => {
    if (transaction.state.facet(documentIdentity) !== transaction.startState.facet(documentIdentity)) return freshLayout();
    const widths = updateLayout(previous.widths, transaction, previous.generation);
    return widths === previous.widths ? previous : { ...previous, widths };
  },
});

export function tableLayoutExtension(documentId: string): Extension {
  return [documentIdentity.of(documentId), layoutField, invertedEffects.of((transaction) => {
    if (!transaction.docChanged || transaction.startState.facet(documentIdentity) !== transaction.state.facet(documentIdentity)) return [];
    const before = transaction.startState.field(layoutField).widths;
    const after = transaction.state.field(layoutField).widths;
    const inverse: StateEffect<WidthChange>[] = [];
    // Position-only edits map naturally; invert only removed or changed column metadata.
    for (const [from, widths] of before) {
      const mapped = mapTableStart(transaction, from);
      const nextWidths = mapped === null ? undefined : after.get(mapped);
      if (!nextWidths || widths.length !== nextWidths.length || widths.some((width, index) => width !== nextWidths[index])) {
        inverse.push(tableWidthsEffect(transaction.startState, from, widths));
      }
    }
    for (const [from] of after) {
      const original = transaction.changes.invertedDesc.mapPos(from, -1);
      if (!before.has(original)) inverse.push(tableWidthsEffect(transaction.startState, original, []));
    }
    return inverse;
  })];
}

export function readTableColumnWidths(state: EditorState, from: number): number[] {
  return [...(state.field(layoutField, false)?.widths.get(from) ?? [])];
}

export function tableWidthsEffect(state: EditorState, from: number, widths: readonly number[]): StateEffect<WidthChange> {
  return changeWidths.of({ generation: state.field(layoutField).generation, from, widths: [...widths] });
}

export function tableWidthsForCommand(
  current: readonly number[], command: TableCommandId, context: TableCommandContext, nextRaw: string,
): number[] {
  if (!current.length || context.rawTable === nextRaw) return [...current];
  const count = parseMarkdownTable(context.rawTable)?.header.length ?? 0;
  const nextCount = parseMarkdownTable(nextRaw)?.header.length ?? 0;
  const widths = Array.from({ length: count }, (_, index) => current[index] ?? 0);
  const column = Math.max(0, Math.min(context.column, count - 1));
  const selected = new Set(context.selectedColumns?.length ? context.selectedColumns : [column]);
  if (command === TABLE_COMMANDS.columnDuplicate) return widths.flatMap((width, index) => selected.has(index) ? [width, width] : [width]);
  if (command === TABLE_COMMANDS.columnDelete) return nextCount === count ? widths : widths.filter((_, index) => !selected.has(index)).slice(0, nextCount);
  if ([TABLE_COMMANDS.columnInsertBefore, TABLE_COMMANDS.columnInsertMultipleBefore].some((id) => id === command)) {
    widths.splice(column, 0, ...Array<number>(Math.max(0, nextCount - count)).fill(0));
  } else if ([TABLE_COMMANDS.columnInsertAfter, TABLE_COMMANDS.columnInsertMultipleAfter].some((id) => id === command)) {
    widths.splice(column + 1, 0, ...Array<number>(Math.max(0, nextCount - count)).fill(0));
  } else {
    const target = command === TABLE_COMMANDS.columnMoveLeft ? column - 1
      : command === TABLE_COMMANDS.columnMoveRight ? column + 1
      : command === TABLE_COMMANDS.columnMove ? context.targetColumn : undefined;
    if (target !== undefined) {
      const [width] = widths.splice(column, 1);
      widths.splice(Math.max(0, Math.min(target, count - 1)), 0, width ?? 0);
    }
  }
  return widths.slice(0, nextCount);
}
