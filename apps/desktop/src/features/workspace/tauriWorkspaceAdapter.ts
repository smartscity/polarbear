import { open, save } from "@tauri-apps/plugin-dialog";
import type { WorkspaceItem } from "./workspaceModel";
import { translateCurrent } from "../../shared/i18n/translate";
import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { hasTauriErrorCode, invokeTauri } from "../../shared/tauri/invokeTauri";

export const WORKSPACE_SAVE_ERROR_CODES = {
  documentChanged: "workspace.documentChanged",
  documentMissing: "workspace.documentMissing",
  saveFailed: "workspace.saveFailed",
} as const;

export type WorkspaceSaveErrorCode =
  typeof WORKSPACE_SAVE_ERROR_CODES[keyof typeof WORKSPACE_SAVE_ERROR_CODES];

export function hasWorkspaceSaveErrorCode(
  error: unknown,
  code: WorkspaceSaveErrorCode,
): boolean {
  return hasTauriErrorCode(error, code);
}

type WorkspaceItemDto = {
  id: string;
  name: string;
  itemType: "file" | "folder";
  children?: WorkspaceItemDto[];
};

type OpenMarkdownFileDto = {
  workspaceRoot: string;
  relativePath: string;
  markdownContent: string;
  revision: string;
  tree: WorkspaceItemDto[];
};

export type MarkdownDocument = {
  markdownContent: string;
  revision: string;
};

export type MarkdownSaveResult = {
  revision: string;
};

export type MarkdownFileRevision = {
  exists: boolean;
  watchToken: string | null;
};

type RenameEntryResponseDto = {
  oldRelativePath: string;
  newRelativePath: string;
};

type DeleteEntryResponseDto = {
  deletedRelativePaths: string[];
};

type DuplicateEntryResponseDto = {
  newRelativePath: string;
};

type AssetWriteResponseDto = {
  assetRelativePath: string;
  markdownInsertText: string;
};

export type ResolveMarkdownAssetResponse = {
  exists: boolean;
  mimeType?: string | null;
  assetUrl?: string | null;
  error?: string | null;
};

function mapWorkspaceItem(item: WorkspaceItemDto): WorkspaceItem {
  return {
    id: item.id,
    name: item.name,
    type: item.itemType,
    children: item.children?.map(mapWorkspaceItem)
  };
}

export async function chooseWorkspaceFolder(): Promise<string | null> {
  const selectedPath = await open({
    directory: true,
    multiple: false,
    title: translateCurrent("dialog.openWorkspace")
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function chooseMarkdownFile(): Promise<string | null> {
  const selectedPath = await open({
    directory: false,
    filters: [
      {
        name: translateCurrent("dialog.fileTypeMarkdown"),
        extensions: ["md", "markdown"]
      }
    ],
    multiple: false,
    title: translateCurrent("dialog.openMarkdownFile")
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function chooseImageFile(): Promise<string | null> {
  const selectedPath = await open({
    directory: false,
    filters: [
      {
        name: translateCurrent("dialog.fileTypeImages"),
        extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"]
      }
    ],
    multiple: false,
    title: translateCurrent("dialog.insertImage")
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function chooseMarkdownSavePath(
  defaultPath: string
): Promise<string | null> {
  const selectedPath = await save({
    defaultPath,
    filters: [
      {
        name: translateCurrent("dialog.fileTypeMarkdown"),
        extensions: ["md", "markdown"]
      }
    ],
    title: translateCurrent("dialog.saveMarkdownFile")
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function listWorkspaceFiles(
  workspaceRoot: string
): Promise<WorkspaceItem[]> {
  const items = await invokeTauri<WorkspaceItemDto[]>(TAURI_COMMANDS.listWorkspaceFiles, {
    workspaceRoot
  });
  return items.map(mapWorkspaceItem);
}

export async function loadMarkdownFile(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<MarkdownDocument> {
  return invokeTauri<MarkdownDocument>(TAURI_COMMANDS.loadMarkdownFile, params);
}

export async function getMarkdownFileRevision(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<MarkdownFileRevision> {
  return invokeTauri<MarkdownFileRevision>(
    TAURI_COMMANDS.getMarkdownFileRevision,
    params,
  );
}

export async function saveMarkdownFile(params: {
  workspaceRoot: string;
  relativePath: string;
  markdownContent: string;
  expectedRevision?: string;
}): Promise<MarkdownSaveResult> {
  return invokeTauri<MarkdownSaveResult>(TAURI_COMMANDS.saveMarkdownFile, params);
}

export async function writeMarkdownFile(params: {
  filePath: string;
  markdownContent: string;
  expectedRevision?: string;
}): Promise<MarkdownSaveResult> {
  return invokeTauri<MarkdownSaveResult>(TAURI_COMMANDS.writeMarkdownFile, params);
}

export async function createMarkdownFile(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<void> {
  await invokeTauri(TAURI_COMMANDS.createMarkdownFile, params);
}

export async function createWorkspaceDirectory(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<void> {
  await invokeTauri(TAURI_COMMANDS.createWorkspaceDirectory, params);
}

export async function deleteWorkspaceEntry(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<DeleteEntryResponseDto> {
  return invokeTauri<DeleteEntryResponseDto>(TAURI_COMMANDS.deleteWorkspaceEntry, params);
}

export async function duplicateWorkspaceEntry(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<DuplicateEntryResponseDto> {
  return invokeTauri<DuplicateEntryResponseDto>(TAURI_COMMANDS.duplicateWorkspaceEntry, params);
}

export async function renameEntry(params: {
  workspaceRoot: string;
  sourceRelativePath: string;
  newName: string;
}): Promise<RenameEntryResponseDto> {
  return invokeTauri<RenameEntryResponseDto>(TAURI_COMMANDS.renameEntry, params);
}

export async function openMarkdownFile(filePath: string): Promise<{
  workspaceRoot: string;
  relativePath: string;
  markdownContent: string;
  revision: string;
  tree: WorkspaceItem[];
}> {
  const openedFile = await invokeTauri<OpenMarkdownFileDto>(TAURI_COMMANDS.openMarkdownFile, {
    filePath
  });

  return {
    workspaceRoot: openedFile.workspaceRoot,
    relativePath: openedFile.relativePath,
    markdownContent: openedFile.markdownContent,
    revision: openedFile.revision,
    tree: openedFile.tree.map(mapWorkspaceItem)
  };
}

export async function revealInFileManager(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<void> {
  await invokeTauri(TAURI_COMMANDS.revealInFileManager, params);
}

export async function moveEntry(params: {
  workspaceRoot: string;
  sourceRelativePath: string;
  targetParentRelativePath?: string | null;
}): Promise<RenameEntryResponseDto> {
  return invokeTauri<RenameEntryResponseDto>(TAURI_COMMANDS.moveEntry, params);
}

export async function copyImageAsset(params: {
  workspaceRoot: string;
  markdownRelativePath: string;
  sourcePath: string;
}): Promise<AssetWriteResponseDto> {
  return invokeTauri<AssetWriteResponseDto>(TAURI_COMMANDS.copyImageAsset, params);
}

export async function saveImageAsset(params: {
  workspaceRoot: string;
  markdownRelativePath: string;
  fileName?: string | null;
  imageBytes: number[];
  extension: string;
}): Promise<AssetWriteResponseDto> {
  return invokeTauri<AssetWriteResponseDto>(TAURI_COMMANDS.saveImageAsset, params);
}

export async function resolveMarkdownAsset(params: {
  workspaceRef: string;
  markdownRelativePath: string;
  assetSrc: string;
}): Promise<ResolveMarkdownAssetResponse> {
  return invokeTauri<ResolveMarkdownAssetResponse>(TAURI_COMMANDS.resolveMarkdownAsset, {
    request: params
  });
}
