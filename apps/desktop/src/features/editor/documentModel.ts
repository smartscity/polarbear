import { findWorkspaceItem, type WorkspaceItem } from "../workspace/workspaceModel";
import { fileNameOf, normalizeWorkspacePath } from "../workspace/workspacePaths";

export type DocumentStructureItem = {
  id: string;
  label: string;
  level: number;
  position: number;
};

export function isUntitledDocument(documentId: string): boolean {
  return documentId.startsWith("untitled:");
}

export function displayNameForDocumentId(
  documentId: string,
  workspaceItems: WorkspaceItem[],
  documentTitles: Record<string, string>,
  documentRelativePaths: Record<string, string>,
  untitledTitle: string,
): string {
  if (!documentId) {
    return untitledTitle;
  }
  if (isUntitledDocument(documentId)) {
    return documentTitles[documentId] ?? untitledTitle;
  }

  const relativePath = documentRelativePathForId(documentId, documentRelativePaths);
  return findWorkspaceItem(workspaceItems, relativePath)?.name ?? fileNameOf(relativePath);
}

export function documentRelativePathForId(
  documentId: string,
  documentRelativePaths: Record<string, string>,
): string {
  return documentRelativePaths[documentId] ?? documentId;
}

export function documentWorkspaceRootForId(
  documentId: string,
  documentWorkspaceRoots: Record<string, string>,
  fallbackWorkspaceRoot: string,
): string {
  if (isUntitledDocument(documentId)) {
    return "";
  }
  return documentWorkspaceRoots[documentId] ?? fallbackWorkspaceRoot;
}

export function findOpenDocumentIdForWorkspaceFile(
  openFileIds: string[],
  documentWorkspaceRoots: Record<string, string>,
  documentRelativePaths: Record<string, string>,
  workspaceRoot: string,
  relativePath: string,
): string | null {
  return openFileIds.find((documentId) => (
    documentWorkspaceRootForId(documentId, documentWorkspaceRoots, workspaceRoot) === workspaceRoot
      && documentRelativePathForId(documentId, documentRelativePaths) === relativePath
  )) ?? null;
}

export function makeWorkspaceDocumentId(params: {
  currentDocumentIds: Set<string>;
  currentWorkspaceRoot: string;
  relativePath: string;
  workspaceRoot: string;
}): string {
  const { currentDocumentIds, currentWorkspaceRoot, relativePath, workspaceRoot } = params;
  if (workspaceRoot === currentWorkspaceRoot && !currentDocumentIds.has(relativePath)) {
    return relativePath;
  }

  const baseId = `${workspaceRoot}::${relativePath}`;
  let documentId = baseId;
  let suffix = 2;
  while (currentDocumentIds.has(documentId)) {
    documentId = `${baseId}#${suffix}`;
    suffix += 1;
  }
  return documentId;
}

export function parentFolderIdOf(documentId: string): string | null {
  if (!documentId || isUntitledDocument(documentId)) {
    return null;
  }

  const pathParts = normalizeWorkspacePath(documentId).split("/");
  pathParts.pop();
  return pathParts.join("/") || null;
}

export function extractDocumentStructure(markdownContent: string): DocumentStructureItem[] {
  const items: DocumentStructureItem[] = [];
  let offset = 0;

  markdownContent.split("\n").forEach((line, index) => {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      const label = headingMatch[2].trim();
      if (label) {
        items.push({
          id: `heading-${index}-${offset}`,
          label,
          level: headingMatch[1].length,
          position: offset,
        });
      }
    }
    offset += line.length + 1;
  });
  return items;
}

export function deriveDefaultMarkdownFileName(
  markdownContent: string,
  fallbackTitle: string,
  untitledTitle: string,
): string {
  const firstHeading = markdownContent
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
    .find(Boolean);
  const rawTitle = firstHeading || fallbackTitle || untitledTitle;
  const safeTitle = rawTitle.replace(/[\\/:*?"<>|]/g, " ").trim() || untitledTitle;
  return /\.(md|markdown)$/i.test(safeTitle) ? safeTitle : `${safeTitle}.md`;
}
