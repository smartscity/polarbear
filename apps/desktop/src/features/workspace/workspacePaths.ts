import type { WorkspaceDocumentMap, WorkspaceItem } from "./workspaceModel";

export function findFirstFile(items: WorkspaceItem[]): WorkspaceItem | null {
  for (const item of items) {
    if (item.type === "file") {
      return item;
    }

    if (item.children) {
      const firstFile = findFirstFile(item.children);
      if (firstFile) {
        return firstFile;
      }
    }
  }

  return null;
}

export function normalizeWorkspacePath(rawPath: string): string {
  return rawPath
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .map((pathPart) => pathPart.trim())
    .filter(Boolean)
    .join("/");
}

export function normalizeMarkdownFileName(rawFileName: string): string {
  const relativePath = normalizeWorkspacePath(rawFileName);
  if (!relativePath) {
    return "";
  }

  return /\.(md|markdown)$/i.test(relativePath)
    ? relativePath
    : `${relativePath}.md`;
}

export function joinWorkspacePath(
  parentPath: string | null,
  childPath: string,
): string {
  const normalizedParentPath = normalizeWorkspacePath(parentPath ?? "");
  const normalizedChildPath = normalizeWorkspacePath(childPath);

  if (!normalizedParentPath) {
    return normalizedChildPath;
  }
  if (!normalizedChildPath) {
    return normalizedParentPath;
  }
  return `${normalizedParentPath}/${normalizedChildPath}`;
}

export function remapPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) {
    return newPath;
  }
  if (path.startsWith(`${oldPath}/`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }
  return path;
}

export function remapDocumentPaths(
  documents: WorkspaceDocumentMap,
  oldPath: string,
  newPath: string,
): WorkspaceDocumentMap {
  return Object.fromEntries(
    Object.entries(documents).map(([path, content]) => [
      remapPath(path, oldPath, newPath),
      content,
    ]),
  );
}

export function remapDirtyFileIds(
  dirtyFileIds: Set<string>,
  oldPath: string,
  newPath: string,
): Set<string> {
  return new Set(
    [...dirtyFileIds].map((dirtyFileId) => remapPath(dirtyFileId, oldPath, newPath)),
  );
}

export function remapDocumentMetadataKeys(
  metadata: Record<string, string>,
  oldPath: string,
  newPath: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([documentId, value]) => [
      remapPath(documentId, oldPath, newPath),
      value,
    ]),
  );
}

export function remapDocumentMetadataPaths(
  metadata: Record<string, string>,
  oldPath: string,
  newPath: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([documentId, relativePath]) => [
      remapPath(documentId, oldPath, newPath),
      remapPath(relativePath, oldPath, newPath),
    ]),
  );
}

export function targetAffectsDirtyFile(
  targetPath: string,
  dirtyFileIds: Set<string>,
): boolean {
  return [...dirtyFileIds].some(
    (dirtyFileId) => dirtyFileId === targetPath || dirtyFileId.startsWith(`${targetPath}/`),
  );
}

export function ensureMarkdownFilePath(filePath: string): string {
  return /\.(md|markdown)$/i.test(filePath) ? filePath : `${filePath}.md`;
}

export function parentPathOf(filePath: string): string {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const pathParts = normalizedPath.split("/");
  pathParts.pop();
  return pathParts.join("/") || "/";
}

export function fileNameOf(filePath: string): string {
  return filePath.replaceAll("\\", "/").split("/").at(-1) ?? "Untitled.md";
}

export function timestampForFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}
