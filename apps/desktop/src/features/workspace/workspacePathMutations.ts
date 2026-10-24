import { remapPath } from "./workspacePaths";
import { addWorkspaceItemToFolder, findWorkspaceItem, type WorkspaceItem } from "./workspaceModel";

/** Session-local admission; native IO separately coordinates all application windows. */
export class WorkspacePathMutations {
  private root: string | null = null;
  private revision = 0;

  isBusy(): boolean { return this.root !== null; }
  affects(root: string): boolean { return this.root === root; }
  readPermission(): () => boolean {
    const revision = this.revision;
    const allowed = !this.isBusy();
    return () => allowed && !this.isBusy() && revision === this.revision;
  }

  begin(root: string): (() => void) | null {
    if (this.isBusy()) return null;
    this.root = root;
    this.revision++;
    let released = false;
    return () => { if (!released) { released = true; this.root = null; } };
  }
}

export function remapWorkspaceTree(items: WorkspaceItem[], from: string, to: string): WorkspaceItem[] {
  const moved = findWorkspaceItem(items, from);
  if (!moved) return items;
  const remove = (nodes: WorkspaceItem[]): WorkspaceItem[] => nodes.filter((item) => item.id !== from)
    .map((item) => item.children ? { ...item, children: remove(item.children) } : item);
  const rename = (item: WorkspaceItem): WorkspaceItem => ({ ...item, id: remapPath(item.id, from, to),
    name: item.id === from ? to.split("/").at(-1)! : item.name, children: item.children?.map(rename) });
  const remaining = remove(items), parent = to.slice(0, Math.max(0, to.lastIndexOf("/")));
  return parent ? addWorkspaceItemToFolder(remaining, parent, rename(moved)) : [...remaining, rename(moved)];
}

export function remapWorkspaceDocumentPaths(
  paths: Record<string, string>, roots: Record<string, string>, root: string, from: string, to: string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(paths).map(([id, path]) => [id, roots[id] === root ? remapPath(path, from, to) : path]));
}
