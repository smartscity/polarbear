import { tableSelectionAsMarkdown, tableSelectionAsTsvForSelection, tableSelectionPositions } from "../table/tableClipboard";
import { readTableInteractionState } from "../table/tableInteractionState";
import type { TableSelection } from "../table/tableTypes";


function shouldCopyTableSelection(rawTable: string, selection: TableSelection): boolean {
  return tableSelectionPositions(rawTable, selection).length > 1;
}

export function writeTableSelectionToClipboard(
  event: ClipboardEvent,
  wrapper: HTMLElement,
  rawTable: string,
): boolean {
  const selection = readTableInteractionState(wrapper).selection;
  if (!selection || !shouldCopyTableSelection(rawTable, selection)) return false;
  const tsv = tableSelectionAsTsvForSelection(rawTable, selection);
  const markdown = tableSelectionAsMarkdown(rawTable, selection);
  if (!tsv) return false;
  event.preventDefault();
  event.stopPropagation();
  event.clipboardData?.setData("text/plain", tsv);
  event.clipboardData?.setData("text/tab-separated-values", tsv);
  event.clipboardData?.setData("text/markdown", markdown);
  return true;
}
