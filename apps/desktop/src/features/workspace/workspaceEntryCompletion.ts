import { documentRelativePathForId, documentWorkspaceRootForId } from "../editor/documentModel";
import { addWorkspaceItemToFolder, findWorkspaceItem, type WorkspaceItem } from "./workspaceModel";

export function containsWorkspacePath(parent: string, path: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

/** A native acknowledgement updates the cached tree even when the next read fails. */
export function projectWorkspaceEntry(items: WorkspaceItem[], entry: WorkspaceItem): WorkspaceItem[] {
  if (findWorkspaceItem(items, entry.id)) return items;
  const parent = entry.id.slice(0, Math.max(0, entry.id.lastIndexOf("/")));
  return parent ? addWorkspaceItemToFolder(items, parent, entry) : [...items, entry];
}

export function removeWorkspaceEntry(items: WorkspaceItem[], path: string): WorkspaceItem[] {
  return items.filter((item) => !containsWorkspacePath(path, item.id))
    .map((item) => item.children ? { ...item, children: removeWorkspaceEntry(item.children, path) } : item);
}

/** Use completion-time state: a clean document at admission may have new local edits. */
export function planDeletedDocuments(snapshot: {
  root: string; path: string; currentRoot: string;
  openIds: readonly string[]; dirtyIds: ReadonlySet<string>;
  roots: Record<string, string>; paths: Record<string, string>;
}): { closed: Set<string>; retained: string[] } {
  const closed = new Set<string>(), retained: string[] = [];
  for (const id of snapshot.openIds) {
    if (documentWorkspaceRootForId(id, snapshot.roots, snapshot.currentRoot) !== snapshot.root
      || !containsWorkspacePath(snapshot.path, documentRelativePathForId(id, snapshot.paths))) continue;
    if (snapshot.dirtyIds.has(id)) retained.push(id);
    else closed.add(id);
  }
  return { closed, retained };
}

export function omitDocumentIds<T>(values: Record<string, T>, removed: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(values).filter(([id]) => !removed.has(id)));
}
