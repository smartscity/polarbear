/**
 * File commands can come from a context menu, the file tree, or the active
 * document. Resolve the target once so every entry point acts on the same item.
 */
export function resolveFileCommandTarget(params: {
  activeFileId: string;
  selectedTreeItemId: string;
  targetPath?: string;
}): string {
  return params.targetPath ?? (params.selectedTreeItemId || params.activeFileId);
}
