use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;
use tauri::{Emitter, Manager};

mod app_paths;
mod app_zoom;
mod cloud_sync_store;
mod document_save;
mod external_url;
mod ipc_contracts;
mod live_caption;
mod memory_admin;
mod native_pinch;
mod reading_native;
mod repository;
mod repository_identity;
mod secret_store;
mod system_open;
mod vocab_bridge;
mod vocab_outbox;
mod workspace_io;
mod workspace_paths;

use document_save::atomic_write;
use repository::{
    policy::allowed_sync_file,
    store::{cloud_sync_database_path, read_binding, scan_sync_files},
};
use workspace_paths::{normalize_relative_path, validate_entry_name, workspace_path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceItemDto {
    id: String,
    name: String,
    item_type: String,
    children: Option<Vec<WorkspaceItemDto>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenMarkdownFileDto {
    workspace_root: String,
    relative_path: String,
    markdown_content: String,
    revision: String,
    tree: Vec<WorkspaceItemDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownDocumentDto {
    markdown_content: String,
    revision: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownFileRevisionDto {
    exists: bool,
    watch_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownSaveResponseDto {
    revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<SaveWarning>,
}

#[derive(Debug, Serialize)]
enum SaveWarning {
    #[serde(rename = "workspace.syncQueueUnavailable")]
    SyncQueueUnavailable,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSaveError {
    code: &'static str,
    message: String,
}

impl WorkspaceSaveError {
    fn document_changed() -> Self {
        Self {
            code: "workspace.documentChanged",
            message:
                "This file changed outside Polarbear. Reload it before saving to avoid overwriting newer content."
                    .to_owned(),
        }
    }

    fn document_missing() -> Self {
        Self {
            code: "workspace.documentMissing",
            message:
                "This file was deleted outside Polarbear. Save it under a new name instead of overwriting newer work."
                    .to_owned(),
        }
    }

    fn unexpected(error: impl Into<String>) -> Self {
        Self {
            code: "workspace.saveFailed",
            message: error.into(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameEntryResponseDto {
    old_relative_path: String,
    new_relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteEntryResponseDto {
    deleted_relative_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateEntryResponseDto {
    new_relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetWriteResponseDto {
    asset_relative_path: String,
    markdown_insert_text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveMarkdownAssetRequest {
    workspace_ref: String,
    markdown_relative_path: String,
    asset_src: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolveMarkdownAssetResponse {
    exists: bool,
    mime_type: Option<String>,
    asset_url: Option<String>,
    error: Option<String>,
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn is_supported_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp"
            )
        })
        .unwrap_or(false)
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .and_then(|extension| match extension.to_ascii_lowercase().as_str() {
            "png" => Some("image/png"),
            "jpg" | "jpeg" => Some("image/jpeg"),
            "gif" => Some("image/gif"),
            "svg" => Some("image/svg+xml"),
            "webp" => Some("image/webp"),
            _ => None,
        })
}

fn markdown_parent_relative_path(markdown_relative_path: &str) -> Result<PathBuf, String> {
    let normalized_path = normalize_relative_path(markdown_relative_path)?;
    Ok(normalized_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default())
}

fn unique_asset_path(asset_directory: &Path, file_name: &str) -> PathBuf {
    let candidate_path = asset_directory.join(file_name);

    if !candidate_path.exists() {
        return candidate_path;
    }

    let source_path = Path::new(file_name);
    let stem = source_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("image");
    let extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("png");

    for index in 1.. {
        let candidate_name = format!("{stem}-{index}.{extension}");
        let candidate_path = asset_directory.join(candidate_name);

        if !candidate_path.exists() {
            return candidate_path;
        }
    }

    unreachable!("asset filename loop is unbounded")
}

fn asset_response(
    workspace_root: &str,
    asset_path: &Path,
    markdown_relative_path: &str,
) -> Result<AssetWriteResponseDto, String> {
    let root = PathBuf::from(workspace_root);
    let asset_relative_path = asset_path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .to_string();
    let markdown_parent = markdown_parent_relative_path(markdown_relative_path)?;
    let path_for_markdown = asset_path
        .strip_prefix(PathBuf::from(workspace_root).join(markdown_parent))
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    Ok(AssetWriteResponseDto {
        asset_relative_path,
        markdown_insert_text: format!("![image](./{})", path_for_markdown),
    })
}

fn resolve_markdown_asset_path(
    workspace_root: &Path,
    markdown_relative_path: &str,
    asset_src: &str,
) -> Result<PathBuf, String> {
    let canonical_workspace_root = workspace_root
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let asset_path = Path::new(asset_src);

    if asset_path.is_absolute() {
        let canonical_asset_path = asset_path
            .canonicalize()
            .map_err(|_| "Image not found.".to_owned())?;

        if !canonical_asset_path.starts_with(&canonical_workspace_root) {
            return Err("Image is outside the current workspace.".to_owned());
        }

        return Ok(canonical_asset_path);
    }

    let markdown_parent = markdown_parent_relative_path(markdown_relative_path)?;
    let mut normalized_path = canonical_workspace_root.join(markdown_parent);

    for component in asset_path.components() {
        match component {
            Component::Normal(value) => normalized_path.push(value),
            Component::CurDir => {}
            Component::ParentDir => {
                if normalized_path == canonical_workspace_root {
                    return Err("Image is outside the current workspace.".to_owned());
                }
                normalized_path.pop();
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Unsupported image path.".to_owned());
            }
        }
    }

    if !normalized_path.starts_with(&canonical_workspace_root) {
        return Err("Image is outside the current workspace.".to_owned());
    }

    let canonical_asset_path = normalized_path
        .canonicalize()
        .map_err(|_| "Image not found.".to_owned())?;
    if !canonical_asset_path.starts_with(&canonical_workspace_root) {
        return Err("Image is outside the current workspace.".to_owned());
    }

    Ok(canonical_asset_path)
}

fn content_revision(content: &[u8]) -> String {
    // A revision detects accidental concurrent writes without exposing document content in the token.
    let hash = content
        .iter()
        .fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x1000_0000_01b3)
        });
    format!("{}-{hash:016x}", content.len())
}

fn item_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_owned()
}

fn list_directory(root: &Path, current_path: &Path) -> Result<Vec<WorkspaceItemDto>, String> {
    let mut items = Vec::new();

    for entry_result in fs::read_dir(current_path).map_err(|error| error.to_string())? {
        let entry = entry_result.map_err(|error| error.to_string())?;
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_symlink()
        {
            continue;
        }
        let relative_path = path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .to_string();

        if path.is_dir() {
            items.push(WorkspaceItemDto {
                id: relative_path,
                name: item_name(&path),
                item_type: "folder".to_owned(),
                children: Some(list_directory(root, &path)?),
            });
        } else if is_markdown_file(&path) {
            items.push(WorkspaceItemDto {
                id: relative_path,
                name: item_name(&path),
                item_type: "file".to_owned(),
                children: None,
            });
        }
    }

    items.sort_by(|left, right| {
        left.item_type
            .cmp(&right.item_type)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(items)
}

#[tauri::command]
fn list_workspace_files(workspace_root: String) -> Result<Vec<WorkspaceItemDto>, String> {
    let root = PathBuf::from(workspace_root);

    if !root.is_dir() {
        return Err("Workspace root is not a directory.".to_owned());
    }

    list_directory(&root, &root)
}

#[tauri::command]
fn load_markdown_file(
    workspace_root: String,
    relative_path: String,
) -> Result<MarkdownDocumentDto, String> {
    let path = workspace_path(&workspace_root, &relative_path)?;

    if !is_markdown_file(&path) {
        return Err("Only Markdown files can be opened.".to_owned());
    }

    read_markdown_document(&path)
}

#[tauri::command]
fn get_markdown_file_revision(
    workspace_root: String,
    relative_path: String,
) -> Result<MarkdownFileRevisionDto, String> {
    let path = workspace_path(&workspace_root, &relative_path)?;

    if !is_markdown_file(&path) {
        return Err("Only Markdown files can be checked.".to_owned());
    }

    match fs::metadata(&path) {
        Ok(metadata) => Ok(MarkdownFileRevisionDto {
            exists: true,
            watch_token: Some(file_watch_token(&metadata)),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(MarkdownFileRevisionDto {
            exists: false,
            watch_token: None,
        }),
        Err(error) => Err(error.to_string()),
    }
}

/// A lightweight change detector for background file watching. The stronger
/// content revision remains the save contract, while this token avoids hashing
/// the full active document every polling interval.
fn file_watch_token(metadata: &fs::Metadata) -> String {
    let modified_nanos = metadata
        .modified()
        .ok()
        .and_then(|timestamp| timestamp.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();

    format!("{}:{modified_nanos}", metadata.len())
}

#[tauri::command]
fn save_markdown_file(
    app: tauri::AppHandle,
    workspace_root: String,
    relative_path: String,
    markdown_content: String,
    expected_revision: Option<String>,
) -> Result<MarkdownSaveResponseDto, WorkspaceSaveError> {
    save_markdown_file_with_outbox(
        &workspace_root,
        &relative_path,
        &markdown_content,
        expected_revision.as_deref(),
        || {
            if read_binding(&app, &workspace_root)?.is_some() {
                cloud_sync_store::queue_outbox_path(
                    &cloud_sync_database_path(&app)?,
                    &workspace_root,
                    &relative_path,
                    "upload",
                )?;
            }
            Ok(())
        },
    )
}

fn save_markdown_file_with_outbox(
    workspace_root: &str,
    relative_path: &str,
    markdown_content: &str,
    expected_revision: Option<&str>,
    enqueue: impl FnOnce() -> Result<(), String>,
) -> Result<MarkdownSaveResponseDto, WorkspaceSaveError> {
    let mut saved = save_markdown_file_content(
        workspace_root,
        relative_path,
        markdown_content,
        expected_revision,
    )?;
    // The local commit cannot be rolled back by optional sync bookkeeping.
    if enqueue().is_err() {
        saved.warning = Some(SaveWarning::SyncQueueUnavailable);
    }
    Ok(saved)
}

fn save_markdown_file_content(
    workspace_root: &str,
    relative_path: &str,
    markdown_content: &str,
    expected_revision: Option<&str>,
) -> Result<MarkdownSaveResponseDto, WorkspaceSaveError> {
    let path =
        workspace_path(workspace_root, relative_path).map_err(WorkspaceSaveError::unexpected)?;

    if !is_markdown_file(&path) {
        return Err(WorkspaceSaveError::unexpected(
            "Only Markdown files can be saved.",
        ));
    }

    document_save::save(
        &path,
        markdown_content.as_bytes(),
        expected_revision,
        document_save::SaveTarget::Existing,
    )
}

#[tauri::command]
fn write_markdown_file(
    file_path: String,
    markdown_content: String,
    expected_revision: Option<String>,
) -> Result<MarkdownSaveResponseDto, WorkspaceSaveError> {
    let path = PathBuf::from(file_path);

    if !is_markdown_file(&path) {
        return Err(WorkspaceSaveError::unexpected(
            "Only Markdown files can be saved.",
        ));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(document_save::save_error)?;
    }

    document_save::save(
        &path,
        markdown_content.as_bytes(),
        expected_revision.as_deref(),
        document_save::SaveTarget::ReplaceOrCreate,
    )
}

fn read_markdown_document(path: &Path) -> Result<MarkdownDocumentDto, String> {
    let markdown_content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    Ok(MarkdownDocumentDto {
        revision: content_revision(markdown_content.as_bytes()),
        markdown_content,
    })
}

#[cfg(test)]
mod engineering_performance;
#[cfg(test)]
mod save_regression_tests;

#[tauri::command]
fn create_markdown_file(workspace_root: String, relative_path: String) -> Result<(), String> {
    let path = workspace_path(&workspace_root, &relative_path)?;

    if !is_markdown_file(&path) {
        return Err("New files must use .md or .markdown extension.".to_owned());
    }

    if path.exists() {
        return Err("File already exists.".to_owned());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    document_save::save(
        &path,
        b"# Untitled\n\nStart writing in Polarbear.\n",
        None,
        document_save::SaveTarget::CreateNew,
    )
    .map(|_| ())
    .map_err(|error| error.message)
}

#[tauri::command]
fn create_workspace_directory(workspace_root: String, relative_path: String) -> Result<(), String> {
    let path = workspace_path(&workspace_root, &relative_path)?;

    if path.exists() {
        return Err("Folder already exists.".to_owned());
    }

    fs::create_dir_all(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_workspace_entry(
    app: tauri::AppHandle,
    workspace_root: String,
    relative_path: String,
) -> Result<DeleteEntryResponseDto, String> {
    if relative_path.trim().is_empty() {
        return Err("Workspace root cannot be deleted.".to_owned());
    }
    let path = workspace_path(&workspace_root, &relative_path)?;
    if !path.exists() {
        return Err("The selected file or folder no longer exists.".to_owned());
    }

    let binding = read_binding(&app, &workspace_root)?;
    let path_prefix = format!("{}/", relative_path.trim_end_matches('/'));
    let mut deleted_sync_paths = binding
        .as_ref()
        .map(|binding| {
            binding
                .manifest
                .keys()
                .filter(|path| *path == &relative_path || path.starts_with(&path_prefix))
                .cloned()
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    if path.is_dir() {
        deleted_sync_paths.extend(scan_sync_files(Path::new(&workspace_root), &path)?.into_keys());
        fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
    } else {
        if allowed_sync_file(&path) {
            deleted_sync_paths.insert(relative_path.clone());
        }
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }

    if binding.is_some() {
        let database_path = cloud_sync_database_path(&app)?;
        for deleted_path in &deleted_sync_paths {
            cloud_sync_store::queue_outbox_path(
                &database_path,
                &workspace_root,
                deleted_path,
                "delete",
            )?;
        }
    }

    Ok(DeleteEntryResponseDto {
        deleted_relative_paths: deleted_sync_paths.into_iter().collect(),
    })
}

#[tauri::command]
fn duplicate_workspace_entry(
    app: tauri::AppHandle,
    workspace_root: String,
    relative_path: String,
) -> Result<DuplicateEntryResponseDto, String> {
    let source_path = workspace_path(&workspace_root, &relative_path)?;
    if !source_path.exists() {
        return Err("The selected file or folder no longer exists.".to_owned());
    }
    let parent = source_path
        .parent()
        .ok_or_else(|| "Workspace root cannot be duplicated.".to_owned())?;
    let destination = next_duplicate_path(&source_path, parent);
    copy_workspace_entry_recursive(&source_path, &destination)?;

    let root = PathBuf::from(&workspace_root);
    let new_relative_path = destination
        .strip_prefix(&root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    if read_binding(&app, &workspace_root)?.is_some() {
        let database_path = cloud_sync_database_path(&app)?;
        let duplicated_files = if destination.is_dir() {
            scan_sync_files(&root, &destination)?
        } else if allowed_sync_file(&destination) {
            BTreeMap::from([(new_relative_path.clone(), destination.clone())])
        } else {
            BTreeMap::new()
        };
        for duplicated_path in duplicated_files.keys() {
            cloud_sync_store::queue_outbox_path(
                &database_path,
                &workspace_root,
                duplicated_path,
                "upload",
            )?;
        }
    }

    Ok(DuplicateEntryResponseDto { new_relative_path })
}

fn next_duplicate_path(source: &Path, parent: &Path) -> PathBuf {
    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Copy");
    let (stem, extension) = if source.is_file() {
        (
            source
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or(file_name),
            source.extension().and_then(|value| value.to_str()),
        )
    } else {
        (file_name, None)
    };
    for index in 1.. {
        let suffix = if index == 1 {
            " copy".to_owned()
        } else {
            format!(" copy {index}")
        };
        let candidate_name = match extension {
            Some(extension) => format!("{stem}{suffix}.{extension}"),
            None => format!("{stem}{suffix}"),
        };
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("duplicate name loop is unbounded")
}

fn copy_workspace_entry_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    if fs::symlink_metadata(source)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Symbolic links cannot be duplicated.".to_owned());
    }
    if source.is_dir() {
        fs::create_dir_all(destination).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            copy_workspace_entry_recursive(&entry.path(), &destination.join(entry.file_name()))?;
        }
        return Ok(());
    }
    fs::copy(source, destination)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn rename_entry(
    workspace_root: String,
    source_relative_path: String,
    new_name: String,
) -> Result<RenameEntryResponseDto, String> {
    let _mutation = workspace_io::path_mutation().map_err(|error| error.to_string())?;
    validate_entry_name(&new_name)?;

    let source_path = workspace_path(&workspace_root, &source_relative_path)?;

    if !source_path.exists() {
        return Err("Entry to rename does not exist.".to_owned());
    }

    let parent_path = source_path
        .parent()
        .ok_or_else(|| "Cannot rename workspace root.".to_owned())?;

    let mut final_name = new_name.trim().to_owned();

    if source_path.is_file() && Path::new(&final_name).extension().is_none() {
        if let Some(extension) = source_path
            .extension()
            .and_then(|extension| extension.to_str())
        {
            final_name.push('.');
            final_name.push_str(extension);
        }
    }

    validate_entry_name(&final_name)?;

    let destination_path = parent_path.join(final_name);

    if destination_path.exists() {
        return Err("An entry with that name already exists.".to_owned());
    }

    workspace_io::rename_exclusive(&source_path, &destination_path)
        .map_err(|error| error.to_string())?;

    let root = PathBuf::from(workspace_root);
    let new_relative_path = destination_path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .to_string();

    Ok(RenameEntryResponseDto {
        old_relative_path: source_relative_path,
        new_relative_path,
    })
}

#[tauri::command]
fn open_markdown_file(file_path: String) -> Result<OpenMarkdownFileDto, String> {
    let path = PathBuf::from(file_path);

    if !path.is_file() {
        return Err("Selected path is not a file.".to_owned());
    }

    if !is_markdown_file(&path) {
        return Err("Only Markdown files can be opened.".to_owned());
    }

    let workspace_root = path
        .parent()
        .ok_or_else(|| "Selected file does not have a parent directory.".to_owned())?
        .to_path_buf();
    let relative_path = path
        .strip_prefix(&workspace_root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .to_string();
    let document = read_markdown_document(&path)?;
    let tree = list_directory(&workspace_root, &workspace_root)?;

    Ok(OpenMarkdownFileDto {
        workspace_root: workspace_root.to_string_lossy().to_string(),
        relative_path,
        markdown_content: document.markdown_content,
        revision: document.revision,
        tree,
    })
}

#[tauri::command]
fn reveal_in_file_manager(workspace_root: String, relative_path: String) -> Result<(), String> {
    let path = workspace_path(&workspace_root, &relative_path)?;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(path)
            .status()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .status()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let reveal_path = if path.is_dir() {
            path
        } else {
            path.parent()
                .ok_or_else(|| "Cannot reveal a path without a parent.".to_owned())?
                .to_path_buf()
        };
        Command::new("xdg-open")
            .arg(reveal_path)
            .status()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Reveal in file manager is not supported on this platform.".to_owned())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    external_url::open(&url)
}

#[tauri::command]
fn open_new_app_window() -> Result<(), String> {
    let executable = env::current_exe().map_err(|error| error.to_string())?;
    Command::new(executable)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn move_entry(
    workspace_root: String,
    source_relative_path: String,
    target_parent_relative_path: Option<String>,
) -> Result<RenameEntryResponseDto, String> {
    let _mutation = workspace_io::path_mutation().map_err(|error| error.to_string())?;
    let workspace_root_path = PathBuf::from(&workspace_root)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let source_path = workspace_path(&workspace_root, &source_relative_path)?;

    if !source_path.exists() {
        return Err("Entry to move does not exist.".to_owned());
    }

    let source_path = source_path
        .canonicalize()
        .map_err(|error| error.to_string())?;

    let target_parent_path = match target_parent_relative_path {
        Some(relative_path) if !relative_path.trim().is_empty() => {
            workspace_path(&workspace_root, &relative_path)?
        }
        _ => workspace_root_path.clone(),
    };

    if !target_parent_path.is_dir() {
        return Err("Move target must be a directory.".to_owned());
    }

    let target_parent_path = target_parent_path
        .canonicalize()
        .map_err(|error| error.to_string())?;

    if !source_path.starts_with(&workspace_root_path)
        || !target_parent_path.starts_with(&workspace_root_path)
    {
        return Err("Move path must stay inside the workspace.".to_owned());
    }

    if source_path.is_dir() && target_parent_path.starts_with(&source_path) {
        return Err("Cannot move a directory into itself.".to_owned());
    }

    let destination_path = target_parent_path.join(item_name(&source_path));

    if destination_path.exists() {
        return Err("An entry with that name already exists in the target folder.".to_owned());
    }

    workspace_io::rename_exclusive(&source_path, &destination_path)
        .map_err(|error| error.to_string())?;

    let new_relative_path = destination_path
        .strip_prefix(workspace_root_path)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .to_string();

    Ok(RenameEntryResponseDto {
        old_relative_path: source_relative_path,
        new_relative_path,
    })
}

#[tauri::command]
fn copy_image_asset(
    workspace_root: String,
    markdown_relative_path: String,
    source_path: String,
) -> Result<AssetWriteResponseDto, String> {
    let source_path = PathBuf::from(source_path);

    if !source_path.is_file() || !is_supported_image_file(&source_path) {
        return Err("Only image files can be inserted.".to_owned());
    }

    let markdown_parent = markdown_parent_relative_path(&markdown_relative_path)?;
    let asset_relative_path = markdown_parent.join("assets");
    let asset_directory = workspace_path(
        &workspace_root,
        asset_relative_path.to_string_lossy().as_ref(),
    )?;
    fs::create_dir_all(&asset_directory).map_err(|error| error.to_string())?;

    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image.png");
    let asset_path = unique_asset_path(&asset_directory, source_name);
    fs::copy(source_path, &asset_path).map_err(|error| error.to_string())?;

    asset_response(&workspace_root, &asset_path, &markdown_relative_path)
}

#[tauri::command]
fn export_png_file(path: String, image_bytes: Vec<u8>) -> Result<(), String> {
    fs::write(&path, image_bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_svg_file(path: String, svg_content: String) -> Result<(), String> {
    fs::write(&path, svg_content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_image_asset(
    workspace_root: String,
    markdown_relative_path: String,
    file_name: Option<String>,
    image_bytes: Vec<u8>,
    extension: String,
) -> Result<AssetWriteResponseDto, String> {
    let extension = extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp"
    ) {
        return Err("Unsupported image type.".to_owned());
    }

    let markdown_parent = markdown_parent_relative_path(&markdown_relative_path)?;
    let asset_relative_path = markdown_parent.join("assets");
    let asset_directory = workspace_path(
        &workspace_root,
        asset_relative_path.to_string_lossy().as_ref(),
    )?;
    fs::create_dir_all(&asset_directory).map_err(|error| error.to_string())?;

    let name = file_name.unwrap_or_else(|| format!("image.{}", extension));
    validate_entry_name(&name)?;
    let asset_path = unique_asset_path(&asset_directory, &name);
    fs::write(&asset_path, image_bytes).map_err(|error| error.to_string())?;

    asset_response(&workspace_root, &asset_path, &markdown_relative_path)
}

#[tauri::command]
fn resolve_markdown_asset(
    request: ResolveMarkdownAssetRequest,
) -> Result<ResolveMarkdownAssetResponse, String> {
    let workspace_root = PathBuf::from(&request.workspace_ref);
    let asset_path = match resolve_markdown_asset_path(
        &workspace_root,
        &request.markdown_relative_path,
        &request.asset_src,
    ) {
        Ok(path) => path,
        Err(error) => {
            return Ok(ResolveMarkdownAssetResponse {
                exists: false,
                mime_type: None,
                asset_url: None,
                error: Some(error),
            });
        }
    };

    if !asset_path.exists() {
        return Ok(ResolveMarkdownAssetResponse {
            exists: false,
            mime_type: None,
            asset_url: None,
            error: Some(format!("Image not found: {}", request.asset_src)),
        });
    }

    if !asset_path.is_file() || !is_supported_image_file(&asset_path) {
        return Ok(ResolveMarkdownAssetResponse {
            exists: false,
            mime_type: None,
            asset_url: None,
            error: Some("Unsupported image type.".to_owned()),
        });
    }

    let mime_type =
        image_mime_type(&asset_path).ok_or_else(|| "Unsupported image type.".to_owned())?;
    let bytes = fs::read(asset_path).map_err(|error| error.to_string())?;

    Ok(ResolveMarkdownAssetResponse {
        exists: true,
        mime_type: Some(mime_type.to_owned()),
        asset_url: Some(format!(
            "data:{};base64,{}",
            mime_type,
            BASE64.encode(bytes)
        )),
        error: None,
    })
}

fn main() -> tauri::Result<()> {
    let builder = tauri::Builder::default()
        .manage(app_zoom::AppZoomState::default())
        .manage(memory_admin::MemoryAdminState::default())
        .manage(live_caption::CaptionService::default())
        .manage(system_open::PendingOpenFiles::default());

    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        system_open::enqueue_open_files(app, system_open::markdown_paths_from_args(args));
    }));

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            vocab_outbox::start(app.handle())?;
            native_pinch::install_native_pinch(app).map_err(std::io::Error::other)?;
            system_open::enqueue_open_files(
                app.handle(),
                system_open::markdown_paths_from_args(std::env::args()),
            );
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "caption-translator" {
                    return;
                }
                window
                    .app_handle()
                    .state::<live_caption::CaptionService>()
                    .halt();
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = app
                        .state::<live_caption::CaptionService>()
                        .stop_serialized();
                });
                if window.label() == "live-caption" {
                    return;
                }
                api.prevent_close();
                let _ = window.emit("polarbear-window-close-requested", ());
            }
        })
        .invoke_handler(|invoke| {
            if matches!(
                invoke.message.webview_ref().label(),
                "live-caption" | "caption-translator"
            ) && invoke.message.command() != "caption_request"
            {
                invoke
                    .resolver
                    .reject("Command is not available to the caption surface");
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                live_caption::caption_request,
                reading_native::begin_document_copy,
                reading_native::begin_image_copy,
                reading_native::write_clipboard_image,
                reading_native::write_document_copy,
                reading_native::speak_reading,
                reading_native::stop_reading_speech,
                app_zoom::set_app_zoom,
                list_workspace_files,
                load_markdown_file,
                get_markdown_file_revision,
                save_markdown_file,
                write_markdown_file,
                create_markdown_file,
                create_workspace_directory,
                delete_workspace_entry,
                duplicate_workspace_entry,
                rename_entry,
                open_markdown_file,
                reveal_in_file_manager,
                open_external_url,
                open_new_app_window,
                quit_app,
                move_entry,
                copy_image_asset,
                save_image_asset,
                export_png_file,
                export_svg_file,
                resolve_markdown_asset,
                repository::repository_connect_provider,
                repository::repository_disconnect_provider,
                repository::repository_get_account,
                repository::repository_list_repositories,
                repository::repository_link_workspace,
                repository::repository_get_workspace_binding,
                repository::repository_get_sync_status,
                repository::repository_push_workspace,
                repository::repository_pull_workspace,
                repository::repository_sync_now,
                memory_admin::memory_admin_bind_workspace,
                memory_admin::memory_admin_request,
                system_open::take_pending_open_files,
                vocab_bridge::vocab_request,
                vocab_outbox::enqueue_vocab_capture,
                vocab_outbox::vocab_capture_status
            ];
            handler(invoke)
        })
        .build(tauri::generate_context!())?;

    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            if app.state::<live_caption::CaptionService>().begin_exit() {
                api.prevent_exit();
                app.state::<live_caption::CaptionService>().halt();
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = app
                        .state::<live_caption::CaptionService>()
                        .stop_serialized();
                    app.exit(0);
                });
            }
        }
        if matches!(event, tauri::RunEvent::Exit) {
            app.state::<vocab_outbox::VocabOutbox>().stop();
        }
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            system_open::enqueue_open_files(app, system_open::markdown_paths_from_urls(urls));
        }
    });

    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    #[cfg(unix)]
    use super::resolve_markdown_asset_path;
    use super::{
        create_markdown_file, create_workspace_directory, get_markdown_file_revision,
        list_workspace_files, load_markdown_file, rename_entry, save_markdown_file_content,
    };
    use std::fs;

    #[test]
    fn workspace_paths_preserve_logical_roots_and_reject_escape(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = test_workspace_root("path-policy");
        let root_path = std::path::Path::new(&root);
        assert_eq!(
            super::workspace_path(&root, "./nested/new.md")?,
            root_path.join("nested/new.md")
        );
        assert!(super::workspace_path(&root, "../outside.md").is_err());
        assert!(super::workspace_path(&root, "/outside.md").is_err());
        fs::write(root_path.join("file.md"), "content")?;
        assert!(
            super::workspace_path(&root_path.join("file.md").to_string_lossy(), "child.md")
                .is_err()
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let alias = root_path.with_extension("alias");
            symlink(root_path, &alias)?;
            assert_eq!(
                super::workspace_path(&alias.to_string_lossy(), "nested/new.md")?,
                alias.join("nested/new.md")
            );
            symlink(
                root_path.parent().ok_or("missing parent")?,
                root_path.join("escape"),
            )?;
            assert!(super::workspace_path(&root, "escape/missing/new.md").is_err());
            symlink(root_path.join("absent"), root_path.join("dangling"))?;
            assert!(super::workspace_path(&root, "dangling/new.md").is_err());
            fs::remove_file(alias)?;
        }
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn workspace_entry_names_keep_the_existing_validation_contract() {
        for name in ["", "  ", ".", "..", "a/b", "a\\b"] {
            assert!(super::validate_entry_name(name).is_err(), "{name:?}");
        }
        for name in ["notes.md", "Notes with spaces", " notes.md "] {
            assert!(super::validate_entry_name(name).is_ok(), "{name:?}");
        }
    }

    fn test_workspace_root(test_name: &str) -> String {
        let test_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "polarbear-workspace-test-{}-{test_name}-{test_id}",
            std::process::id()
        ));

        if root.exists() {
            fs::remove_dir_all(&root).expect("remove stale test workspace");
        }

        fs::create_dir_all(&root).expect("create test workspace");
        root.to_string_lossy().to_string()
    }

    #[test]
    fn workspace_commands_create_save_load_and_list_markdown_files() {
        let root = test_workspace_root("create-save-load-list");

        create_workspace_directory(root.clone(), "docs".to_owned())
            .expect("create workspace directory");
        create_markdown_file(root.clone(), "docs/guide.md".to_owned())
            .expect("create markdown file");
        let saved = save_markdown_file_content(
            &root,
            "docs/guide.md",
            "# Guide\n\nSaved from Polarbear.\n",
            None,
        )
        .expect("save markdown file");

        let source =
            load_markdown_file(root.clone(), "docs/guide.md".to_owned()).expect("load markdown");
        let items = list_workspace_files(root).expect("list workspace files");

        assert!(source.markdown_content.contains("Saved from Polarbear"));
        assert_eq!(source.revision, saved.revision);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "docs");
        assert_eq!(
            items[0].children.as_ref().expect("folder children")[0].name,
            "guide.md"
        );
    }

    #[test]
    fn workspace_commands_rename_files_and_directories() {
        let root = test_workspace_root("rename-files-directories");

        create_workspace_directory(root.clone(), "docs".to_owned())
            .expect("create workspace directory");
        create_markdown_file(root.clone(), "docs/hello.md".to_owned())
            .expect("create markdown file");

        let file_rename =
            rename_entry(root.clone(), "docs/hello.md".to_owned(), "world".to_owned())
                .expect("rename markdown file");
        let directory_rename = rename_entry(root.clone(), "docs".to_owned(), "notes".to_owned())
            .expect("rename directory");
        let source =
            load_markdown_file(root, "notes/world.md".to_owned()).expect("load renamed markdown");

        assert_eq!(file_rename.new_relative_path, "docs/world.md");
        assert_eq!(directory_rename.new_relative_path, "notes");
        assert!(source
            .markdown_content
            .contains("Start writing in Polarbear"));
    }

    #[cfg(unix)]
    #[test]
    fn workspace_commands_do_not_follow_symlinks_outside_the_workspace() {
        use std::os::unix::fs::symlink;

        let root = test_workspace_root("reject-symlink-escape");
        let external_root = test_workspace_root("symlink-escape-target");
        fs::write(
            std::path::Path::new(&external_root).join("outside.md"),
            "# Outside\n",
        )
        .expect("create external markdown file");
        fs::write(
            std::path::Path::new(&external_root).join("outside.png"),
            b"not-a-real-image",
        )
        .expect("create external image file");
        symlink(&external_root, std::path::Path::new(&root).join("linked"))
            .expect("create workspace symlink");

        assert!(load_markdown_file(root.clone(), "linked/outside.md".to_owned()).is_err());
        assert!(create_markdown_file(root.clone(), "linked/new.md".to_owned()).is_err());
        assert!(list_workspace_files(root.clone())
            .expect("list workspace files")
            .is_empty());
        assert!(resolve_markdown_asset_path(
            std::path::Path::new(&root),
            "note.md",
            "linked/outside.png",
        )
        .is_err());
        assert!(!std::path::Path::new(&external_root).join("new.md").exists());

        fs::remove_file(std::path::Path::new(&root).join("linked"))
            .expect("remove workspace symlink");
        fs::remove_dir_all(root).expect("cleanup workspace");
        fs::remove_dir_all(external_root).expect("cleanup external workspace");
    }

    #[test]
    fn save_rejects_an_externally_changed_document_without_overwriting_it() {
        let root = test_workspace_root("save-rejects-external-change");
        create_markdown_file(root.clone(), "note.md".to_owned()).expect("create markdown file");
        let loaded =
            load_markdown_file(root.clone(), "note.md".to_owned()).expect("load markdown file");

        fs::write(
            std::path::Path::new(&root).join("note.md"),
            "# Changed outside Polarbear\n",
        )
        .expect("simulate external write");

        let error = save_markdown_file_content(
            &root,
            "note.md",
            "# Local pending change\n",
            Some(&loaded.revision),
        )
        .expect_err("conflicting save must fail");

        assert_eq!(error.code, "workspace.documentChanged");
        assert!(error.message.contains("changed outside Polarbear"));
        let current = fs::read_to_string(std::path::Path::new(&root).join("note.md"))
            .expect("read externally changed file");
        assert_eq!(current, "# Changed outside Polarbear\n");
    }

    #[test]
    fn save_reports_when_an_open_document_was_deleted_externally() {
        let root = test_workspace_root("save-rejects-external-delete");
        create_markdown_file(root.clone(), "note.md".to_owned()).expect("create markdown file");
        let loaded =
            load_markdown_file(root.clone(), "note.md".to_owned()).expect("load markdown file");
        let path = std::path::Path::new(&root).join("note.md");
        fs::remove_file(&path).expect("simulate external deletion");

        let error = save_markdown_file_content(
            &root,
            "note.md",
            "# Local pending change\n",
            Some(&loaded.revision),
        )
        .expect_err("saving a deleted document must fail");

        assert_eq!(error.code, "workspace.documentMissing");
        assert!(error.message.contains("deleted outside Polarbear"));
        assert!(!path.exists());
    }

    #[test]
    fn markdown_file_watch_reports_a_missing_file_without_using_an_error_string() {
        let root = test_workspace_root("revision-reports-missing-file");
        let revision = get_markdown_file_revision(root, "missing.md".to_owned())
            .expect("missing files should be represented in the revision response");

        assert!(!revision.exists);
        assert_eq!(revision.watch_token, None);
    }

    #[test]
    fn markdown_file_watch_reports_a_metadata_token_for_existing_files() {
        let root = test_workspace_root("revision-reports-existing-file");
        create_markdown_file(root.clone(), "note.md".to_owned()).expect("create markdown file");

        let revision = get_markdown_file_revision(root, "note.md".to_owned())
            .expect("existing files should be represented in the revision response");

        assert!(revision.exists);
        assert!(revision.watch_token.is_some());
    }
}
