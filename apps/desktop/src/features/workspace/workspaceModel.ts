export type WorkspaceItem = {
  id: string;
  name: string;
  type: "file" | "folder";
  children?: WorkspaceItem[];
};

export type WorkspaceDocumentMap = Record<string, string>;

/**
 * Compares the filesystem tree structurally without serializing it on every
 * polling interval. Item ordering remains significant because it is the order
 * displayed in the file tree.
 */
export function workspaceTreesEqual(
  left: WorkspaceItem[],
  right: WorkspaceItem[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => {
    const other = right[index];
    if (!other || item.id !== other.id || item.name !== other.name || item.type !== other.type) {
      return false;
    }

    return workspaceTreesEqual(item.children ?? [], other.children ?? []);
  });
}

export function findWorkspaceItem(
  items: WorkspaceItem[],
  itemId: string
): WorkspaceItem | null {
  for (const item of items) {
    if (item.id === itemId) {
      return item;
    }

    if (item.children) {
      const foundItem = findWorkspaceItem(item.children, itemId);
      if (foundItem) {
        return foundItem;
      }
    }
  }

  return null;
}

export function addWorkspaceItemToFolder(
  items: WorkspaceItem[],
  folderId: string,
  itemToAdd: WorkspaceItem
): WorkspaceItem[] {
  return items.map((item) => {
    if (item.id === folderId && item.type === "folder") {
      return {
        ...item,
        children: [...(item.children ?? []), itemToAdd]
      };
    }

    if (item.children) {
      return {
        ...item,
        children: addWorkspaceItemToFolder(item.children, folderId, itemToAdd)
      };
    }

    return item;
  });
}

export function countWorkspaceItems(items: WorkspaceItem[]): number {
  return items.reduce((count, item) => {
    return count + 1 + (item.children ? countWorkspaceItems(item.children) : 0);
  }, 0);
}
