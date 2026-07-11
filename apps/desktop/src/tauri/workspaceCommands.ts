import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { WorkspaceItem } from "../model/WorkspaceFile";

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
  tree: WorkspaceItemDto[];
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
    title: "Open Polarbear Workspace"
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function chooseMarkdownFile(): Promise<string | null> {
  const selectedPath = await open({
    directory: false,
    filters: [
      {
        name: "Markdown",
        extensions: ["md", "markdown"]
      }
    ],
    multiple: false,
    title: "Open Markdown File"
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function chooseImageFile(): Promise<string | null> {
  const selectedPath = await open({
    directory: false,
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"]
      }
    ],
    multiple: false,
    title: "Insert Image"
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
        name: "Markdown",
        extensions: ["md", "markdown"]
      }
    ],
    title: "Save Markdown File"
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function listWorkspaceFiles(
  workspaceRoot: string
): Promise<WorkspaceItem[]> {
  const items = await invoke<WorkspaceItemDto[]>("list_workspace_files", {
    workspaceRoot
  });
  return items.map(mapWorkspaceItem);
}

export async function refreshWorkspaceSyncIndex(
  workspaceRoot: string
): Promise<number> {
  return invoke<number>("refresh_workspace_sync_index", { workspaceRoot });
}

export async function loadMarkdownFile(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<string> {
  return invoke<string>("load_markdown_file", params);
}

export async function saveMarkdownFile(params: {
  workspaceRoot: string;
  relativePath: string;
  markdownContent: string;
}): Promise<void> {
  await invoke("save_markdown_file", params);
}

export async function writeMarkdownFile(params: {
  filePath: string;
  markdownContent: string;
}): Promise<void> {
  await invoke("write_markdown_file", params);
}

export async function createMarkdownFile(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<void> {
  await invoke("create_markdown_file", params);
}

export async function createWorkspaceDirectory(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<void> {
  await invoke("create_workspace_directory", params);
}

export async function deleteWorkspaceEntry(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<DeleteEntryResponseDto> {
  return invoke<DeleteEntryResponseDto>("delete_workspace_entry", params);
}

export async function duplicateWorkspaceEntry(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<DuplicateEntryResponseDto> {
  return invoke<DuplicateEntryResponseDto>("duplicate_workspace_entry", params);
}

export async function renameEntry(params: {
  workspaceRoot: string;
  sourceRelativePath: string;
  newName: string;
}): Promise<RenameEntryResponseDto> {
  return invoke<RenameEntryResponseDto>("rename_entry", params);
}

export async function openMarkdownFile(filePath: string): Promise<{
  workspaceRoot: string;
  relativePath: string;
  markdownContent: string;
  tree: WorkspaceItem[];
}> {
  const openedFile = await invoke<OpenMarkdownFileDto>("open_markdown_file", {
    filePath
  });

  return {
    workspaceRoot: openedFile.workspaceRoot,
    relativePath: openedFile.relativePath,
    markdownContent: openedFile.markdownContent,
    tree: openedFile.tree.map(mapWorkspaceItem)
  };
}

export async function revealInFileManager(params: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<void> {
  await invoke("reveal_in_file_manager", params);
}

export async function moveEntry(params: {
  workspaceRoot: string;
  sourceRelativePath: string;
  targetParentRelativePath?: string | null;
}): Promise<RenameEntryResponseDto> {
  return invoke<RenameEntryResponseDto>("move_entry", params);
}

export async function copyImageAsset(params: {
  workspaceRoot: string;
  markdownRelativePath: string;
  sourcePath: string;
}): Promise<AssetWriteResponseDto> {
  return invoke<AssetWriteResponseDto>("copy_image_asset", params);
}

export async function saveImageAsset(params: {
  workspaceRoot: string;
  markdownRelativePath: string;
  fileName?: string | null;
  imageBytes: number[];
  extension: string;
}): Promise<AssetWriteResponseDto> {
  return invoke<AssetWriteResponseDto>("save_image_asset", params);
}

export async function resolveMarkdownAsset(params: {
  workspaceRef: string;
  markdownRelativePath: string;
  assetSrc: string;
}): Promise<ResolveMarkdownAssetResponse> {
  return invoke<ResolveMarkdownAssetResponse>("resolve_markdown_asset", {
    request: params
  });
}
