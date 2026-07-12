import {
  EMPTY_TABLE_INTERACTION_STATE,
  type TableInteractionState,
} from "./tableTypes";

const interactionByTable = new WeakMap<HTMLElement, TableInteractionState>();

export function readTableInteractionState(table: HTMLElement): TableInteractionState {
  return interactionByTable.get(table) ?? { ...EMPTY_TABLE_INTERACTION_STATE };
}

export function updateTableInteractionState(
  table: HTMLElement,
  patch: Partial<TableInteractionState>,
): TableInteractionState {
  const next = { ...readTableInteractionState(table), ...patch };
  interactionByTable.set(table, next);
  return next;
}

export function clearTableInteractionState(table: HTMLElement): void {
  interactionByTable.delete(table);
}
