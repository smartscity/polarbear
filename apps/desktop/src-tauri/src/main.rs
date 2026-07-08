use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State, WebviewWindow};

mod native_pinch;

const DEFAULT_APP_ZOOM: f64 = 1.0;
const MIN_APP_ZOOM: f64 = 0.5;
const MAX_APP_ZOOM: f64 = 3.0;
const APP_ZOOM_STEP: f64 = 0.1;

struct AppZoomState {
    zoom: Mutex<f64>,
}

impl Default for AppZoomState {
    fn default() -> Self {
        Self {
            zoom: Mutex::new(DEFAULT_APP_ZOOM),
        }
    }
}

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
    tree: Vec<WorkspaceItemDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameEntryResponseDto {
    old_relative_path: String,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateGithubTokenRequest {
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkWorkspaceRequest {
    workspace_ref: String,
    owner: String,
    repo: String,
    branch: String,
    remote_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSyncRequest {
    workspace_ref: String,
    dirty: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepositoryAccountDto {
    provider: String,
    account_id: String,
    login: String,
    avatar_url: Option<String>,
    connected_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GithubRepositoryDto {
    owner: String,
    name: String,
    full_name: String,
    default_branch: String,
    private: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepositoryBindingDto {
    workspace_ref: String,
    provider: String,
    owner: String,
    repo: String,
    branch: String,
    remote_path: String,
    last_sync_commit_sha: Option<String>,
    last_sync_at: Option<i64>,
    manifest: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositorySyncStatusDto {
    account: Option<RepositoryAccountDto>,
    binding: Option<RepositoryBindingDto>,
    local_changes: usize,
    remote_changed: bool,
    conflicts: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GithubUserResponse {
    id: u64,
    login: String,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRepoOwnerResponse {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GithubRepoResponse {
    name: String,
    full_name: String,
    default_branch: String,
    private: bool,
    owner: GithubRepoOwnerResponse,
}

#[derive(Debug, Deserialize)]
struct GithubBranchResponse {
    commit: GithubCommitRef,
}

#[derive(Debug, Deserialize)]
struct GithubCommitRef {
    sha: String,
}

#[derive(Debug, Deserialize)]
struct GithubContentResponse {
    sha: String,
    content: Option<String>,
    encoding: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubTreeResponse {
    tree: Vec<GithubTreeItemResponse>,
}

#[derive(Debug, Deserialize)]
struct GithubTreeItemResponse {
    path: String,
    #[serde(rename = "type")]
    item_type: String,
}

#[derive(Debug, Serialize)]
struct GithubPutContentRequest<'a> {
    message: &'a str,
    content: String,
    branch: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha: Option<String>,
}

fn normalize_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);

    if path.is_absolute() {
        return Err("Absolute paths are not allowed inside a workspace.".to_owned());
    }

    let mut normalized_path = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Normal(value) => normalized_path.push(value),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("Parent directory traversal is not allowed.".to_owned());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Unsupported path component.".to_owned());
            }
        }
    }

    Ok(normalized_path)
}

fn workspace_path(workspace_root: &str, relative_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(workspace_root);

    if !root.is_dir() {
        return Err("Workspace root is not a directory.".to_owned());
    }

    Ok(root.join(normalize_relative_path(relative_path)?))
}

fn validate_entry_name(name: &str) -> Result<(), String> {
    let trimmed_name = name.trim();

    if trimmed_name.is_empty() {
        return Err("Name cannot be empty.".to_owned());
    }

    if trimmed_name == "."
        || trimmed_name == ".."
        || trimmed_name.contains('/')
        || trimmed_name.contains('\\')
    {
        return Err(
            "Name cannot contain path separators or parent directory traversal.".to_owned(),
        );
    }

    Ok(())
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

    Ok(normalized_path)
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn app_config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn account_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join("repository-account.json"))
}

fn bindings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join("repository-bindings.json"))
}

fn read_account(app: &tauri::AppHandle) -> Result<Option<RepositoryAccountDto>, String> {
    let path = account_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map(Some).map_err(|error| error.to_string())
}

fn write_account(app: &tauri::AppHandle, account: &RepositoryAccountDto) -> Result<(), String> {
    let content = serde_json::to_string_pretty(account).map_err(|error| error.to_string())?;
    fs::write(account_path(app)?, content).map_err(|error| error.to_string())
}

fn delete_account(app: &tauri::AppHandle) -> Result<(), String> {
    let path = account_path(app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn read_bindings(app: &tauri::AppHandle) -> Result<BTreeMap<String, RepositoryBindingDto>, String> {
    let path = bindings_path(app)?;
    if !path.exists() {
        return Ok(BTreeMap::new());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn write_bindings(
    app: &tauri::AppHandle,
    bindings: &BTreeMap<String, RepositoryBindingDto>,
) -> Result<(), String> {
    let content = serde_json::to_string_pretty(bindings).map_err(|error| error.to_string())?;
    fs::write(bindings_path(app)?, content).map_err(|error| error.to_string())
}

fn read_binding(
    app: &tauri::AppHandle,
    workspace_ref: &str,
) -> Result<Option<RepositoryBindingDto>, String> {
    Ok(read_bindings(app)?.get(workspace_ref).cloned())
}

trait SecretStore {
    fn save_secret(&self, key: &str, value: &str) -> Result<(), String>;
    fn get_secret(&self, key: &str) -> Result<Option<String>, String>;
    fn delete_secret(&self, key: &str) -> Result<(), String>;
}

struct KeychainSecretStore;

impl SecretStore for KeychainSecretStore {
    fn save_secret(&self, key: &str, value: &str) -> Result<(), String> {
        let entry = keyring::Entry::new("dev.polarbear.app", key)
            .map_err(|error| error.to_string())?;
        entry.set_password(value).map_err(|error| error.to_string())
    }

    fn get_secret(&self, key: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new("dev.polarbear.app", key)
            .map_err(|error| error.to_string())?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn delete_secret(&self, key: &str) -> Result<(), String> {
        let entry = keyring::Entry::new("dev.polarbear.app", key)
            .map_err(|error| error.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

fn github_client(token: &str) -> Result<Client, String> {
    Client::builder()
        .user_agent("Polarbear")
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            let auth_value = format!("Bearer {token}");
            headers.insert(
                reqwest::header::AUTHORIZATION,
                reqwest::header::HeaderValue::from_str(&auth_value)
                    .map_err(|error| error.to_string())?,
            );
            headers.insert(
                reqwest::header::ACCEPT,
                reqwest::header::HeaderValue::from_static("application/vnd.github+json"),
            );
            headers
        })
        .build()
        .map_err(|error| error.to_string())
}

fn github_token() -> Result<String, String> {
    KeychainSecretStore
        .get_secret("github_token")?
        .ok_or_else(|| "Connect GitHub before using repository sync.".to_owned())
}

fn github_get<T: for<'de> Deserialize<'de>>(client: &Client, url: &str) -> Result<T, String> {
    client
        .get(url)
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<T>()
        .map_err(|error| error.to_string())
}

fn github_put<T: Serialize, R: for<'de> Deserialize<'de>>(
    client: &Client,
    url: &str,
    body: &T,
) -> Result<R, String> {
    client
        .put(url)
        .json(body)
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<R>()
        .map_err(|error| error.to_string())
}

fn branch_head_sha(client: &Client, binding: &RepositoryBindingDto) -> Result<String, String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/branches/{}",
        binding.owner,
        binding.repo,
        urlencoding::encode(&binding.branch)
    );
    Ok(github_get::<GithubBranchResponse>(client, &url)?.commit.sha)
}

fn allowed_sync_file(path: &Path) -> bool {
    let excluded = [
        ".git",
        "node_modules",
        ".DS_Store",
        ".idea",
        ".vscode",
        "target",
        "dist",
        "build",
    ];

    if path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|part| excluded.contains(&part))
            .unwrap_or(false)
    }) {
        return false;
    }

    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md"
                    | "markdown"
                    | "mmd"
                    | "puml"
                    | "plantuml"
                    | "uml"
                    | "png"
                    | "jpg"
                    | "jpeg"
                    | "gif"
                    | "svg"
                    | "webp"
                    | "pdf"
            )
        })
        .unwrap_or(false)
}

fn scan_sync_files(root: &Path, current: &Path) -> Result<BTreeMap<String, PathBuf>, String> {
    let mut files = BTreeMap::new();

    for entry_result in fs::read_dir(current).map_err(|error| error.to_string())? {
        let entry = entry_result.map_err(|error| error.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            files.extend(scan_sync_files(root, &path)?);
        } else if allowed_sync_file(&path) {
            let relative_path = path
                .strip_prefix(root)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            files.insert(relative_path, path);
        }
    }

    Ok(files)
}

fn file_digest(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("{}:{}", bytes.len(), BASE64.encode(bytes)))
}

fn local_manifest(workspace_root: &str) -> Result<BTreeMap<String, String>, String> {
    let root = PathBuf::from(workspace_root);
    let files = scan_sync_files(&root, &root)?;
    let mut manifest = BTreeMap::new();

    for (relative_path, path) in files {
        manifest.insert(relative_path, file_digest(&path)?);
    }

    Ok(manifest)
}

fn remote_path_for(binding: &RepositoryBindingDto, relative_path: &str) -> String {
    let remote_root = binding.remote_path.trim_matches('/');
    if remote_root.is_empty() {
        relative_path.to_owned()
    } else {
        format!("{remote_root}/{relative_path}")
    }
}

fn github_content_url(binding: &RepositoryBindingDto, relative_path: &str) -> String {
    let encoded_path = remote_path_for(binding, relative_path)
        .split('/')
        .map(|part| urlencoding::encode(part).to_string())
        .collect::<Vec<_>>()
        .join("/");
    format!(
        "https://api.github.com/repos/{}/{}/contents/{}",
        binding.owner, binding.repo, encoded_path
    )
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
fn load_markdown_file(workspace_root: String, relative_path: String) -> Result<String, String> {
    let path = workspace_path(&workspace_root, &relative_path)?;

    if !is_markdown_file(&path) {
        return Err("Only Markdown files can be opened.".to_owned());
    }

    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_markdown_file(
    workspace_root: String,
    relative_path: String,
    markdown_content: String,
) -> Result<(), String> {
    let path = workspace_path(&workspace_root, &relative_path)?;

    if !is_markdown_file(&path) {
        return Err("Only Markdown files can be saved.".to_owned());
    }

    fs::write(path, markdown_content).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_markdown_file(file_path: String, markdown_content: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);

    if !is_markdown_file(&path) {
        return Err("Only Markdown files can be saved.".to_owned());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(path, markdown_content).map_err(|error| error.to_string())
}

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

    fs::write(path, "# Untitled\n\nStart writing in Polarbear.\n")
        .map_err(|error| error.to_string())
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
fn rename_entry(
    workspace_root: String,
    source_relative_path: String,
    new_name: String,
) -> Result<RenameEntryResponseDto, String> {
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

    fs::rename(&source_path, &destination_path).map_err(|error| error.to_string())?;

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
    let markdown_content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let tree = list_directory(&workspace_root, &workspace_root)?;

    Ok(OpenMarkdownFileDto {
        workspace_root: workspace_root.to_string_lossy().to_string(),
        relative_path,
        markdown_content,
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
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http and https URLs can be opened externally.".to_owned());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .status()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(url)
            .status()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url)
            .status()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening external URLs is not supported on this platform.".to_owned())
}

#[tauri::command]
fn move_entry(
    workspace_root: String,
    source_relative_path: String,
    target_parent_relative_path: Option<String>,
) -> Result<RenameEntryResponseDto, String> {
    let workspace_root_path = PathBuf::from(&workspace_root)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let source_path = workspace_path(&workspace_root, &source_relative_path)?;

    if !source_path.exists() {
        return Err("Entry to move does not exist.".to_owned());
    }

    let source_path = source_path.canonicalize().map_err(|error| error.to_string())?;

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

    fs::rename(&source_path, &destination_path).map_err(|error| error.to_string())?;

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
    let asset_directory = PathBuf::from(&workspace_root)
        .join(markdown_parent)
        .join("assets");
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
fn save_image_asset(
    workspace_root: String,
    markdown_relative_path: String,
    file_name: Option<String>,
    image_bytes: Vec<u8>,
    extension: String,
) -> Result<AssetWriteResponseDto, String> {
    let extension = extension.trim().trim_start_matches('.').to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp"
    ) {
        return Err("Unsupported image type.".to_owned());
    }

    let markdown_parent = markdown_parent_relative_path(&markdown_relative_path)?;
    let asset_directory = PathBuf::from(&workspace_root)
        .join(markdown_parent)
        .join("assets");
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

    let mime_type = image_mime_type(&asset_path)
        .ok_or_else(|| "Unsupported image type.".to_owned())?;
    let bytes = fs::read(asset_path).map_err(|error| error.to_string())?;

    Ok(ResolveMarkdownAssetResponse {
        exists: true,
        mime_type: Some(mime_type.to_owned()),
        asset_url: Some(format!("data:{};base64,{}", mime_type, BASE64.encode(bytes))),
        error: None,
    })
}

#[tauri::command]
fn repository_validate_github_token(
    app: tauri::AppHandle,
    request: ValidateGithubTokenRequest,
) -> Result<RepositoryAccountDto, String> {
    let token = request.token.trim();
    if token.is_empty() {
        return Err("GitHub token cannot be empty.".to_owned());
    }

    let client = github_client(token)?;
    let user = github_get::<GithubUserResponse>(&client, "https://api.github.com/user")?;
    KeychainSecretStore.save_secret("github_token", token)?;

    let account = RepositoryAccountDto {
        provider: "github".to_owned(),
        account_id: user.id.to_string(),
        login: user.login,
        avatar_url: user.avatar_url,
        connected_at: now_unix_seconds(),
    };
    write_account(&app, &account)?;
    Ok(account)
}

#[tauri::command]
fn repository_disconnect_github(app: tauri::AppHandle) -> Result<(), String> {
    KeychainSecretStore.delete_secret("github_token")?;
    delete_account(&app)
}

#[tauri::command]
fn repository_get_account(app: tauri::AppHandle) -> Result<Option<RepositoryAccountDto>, String> {
    read_account(&app)
}

#[tauri::command]
fn repository_list_github_repositories() -> Result<Vec<GithubRepositoryDto>, String> {
    let token = github_token()?;
    let client = github_client(&token)?;
    let repos = github_get::<Vec<GithubRepoResponse>>(
        &client,
        "https://api.github.com/user/repos?per_page=100&sort=updated",
    )?;

    Ok(repos
        .into_iter()
        .map(|repo| GithubRepositoryDto {
            owner: repo.owner.login,
            name: repo.name,
            full_name: repo.full_name,
            default_branch: repo.default_branch,
            private: repo.private,
        })
        .collect())
}

#[tauri::command]
fn repository_link_workspace(
    app: tauri::AppHandle,
    request: LinkWorkspaceRequest,
) -> Result<RepositoryBindingDto, String> {
    if request.workspace_ref.trim().is_empty() {
        return Err("Open a workspace before linking a repository.".to_owned());
    }

    let token = github_token()?;
    let client = github_client(&token)?;
    let mut binding = RepositoryBindingDto {
        workspace_ref: request.workspace_ref,
        provider: "github".to_owned(),
        owner: request.owner,
        repo: request.repo,
        branch: request.branch,
        remote_path: request.remote_path,
        last_sync_commit_sha: None,
        last_sync_at: None,
        manifest: BTreeMap::new(),
    };
    let head_sha = branch_head_sha(&client, &binding)?;
    binding.last_sync_commit_sha = Some(head_sha);
    binding.last_sync_at = Some(now_unix_seconds());
    binding.manifest = local_manifest(&binding.workspace_ref)?;

    let mut bindings = read_bindings(&app)?;
    bindings.insert(binding.workspace_ref.clone(), binding.clone());
    write_bindings(&app, &bindings)?;
    Ok(binding)
}

#[tauri::command]
fn repository_get_workspace_binding(
    app: tauri::AppHandle,
    workspace_ref: String,
) -> Result<Option<RepositoryBindingDto>, String> {
    read_binding(&app, &workspace_ref)
}

#[tauri::command]
fn repository_unlink_workspace(app: tauri::AppHandle, workspace_ref: String) -> Result<(), String> {
    let mut bindings = read_bindings(&app)?;
    bindings.remove(&workspace_ref);
    write_bindings(&app, &bindings)
}

#[tauri::command]
fn repository_get_sync_status(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
) -> Result<RepositorySyncStatusDto, String> {
    let account = read_account(&app)?;
    let binding = read_binding(&app, &request.workspace_ref)?;
    let local_changes = match binding.as_ref() {
        Some(binding) => local_manifest(&binding.workspace_ref)?
            .iter()
            .filter(|(path, digest)| binding.manifest.get(*path) != Some(*digest))
            .count(),
        None => 0,
    };
    let remote_changed = match binding.as_ref() {
        Some(binding) => {
            let token = github_token()?;
            let client = github_client(&token)?;
            binding.last_sync_commit_sha.as_deref() != Some(&branch_head_sha(&client, binding)?)
        }
        None => false,
    };

    Ok(RepositorySyncStatusDto {
        account,
        binding,
        local_changes,
        remote_changed,
        conflicts: if request.dirty {
            vec!["Save current document before syncing.".to_owned()]
        } else {
            Vec::new()
        },
    })
}

#[tauri::command]
fn repository_push_workspace(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
) -> Result<RepositorySyncStatusDto, String> {
    if request.dirty {
        return Err("Save current document before pushing.".to_owned());
    }

    let mut binding = read_binding(&app, &request.workspace_ref)?
        .ok_or_else(|| "Link this workspace to a GitHub repository before pushing.".to_owned())?;
    let token = github_token()?;
    let client = github_client(&token)?;
    let remote_head = branch_head_sha(&client, &binding)?;

    if binding.last_sync_commit_sha.as_deref() != Some(&remote_head) {
        return Err("Remote repository changed. Pull before pushing.".to_owned());
    }

    let root = PathBuf::from(&binding.workspace_ref);
    let files = scan_sync_files(&root, &root)?;

    for (relative_path, path) in files {
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        let content_sha = github_content_sha(&client, &binding, &relative_path)?;
        let body = GithubPutContentRequest {
            message: "Update notes from Polarbear",
            content: BASE64.encode(bytes),
            branch: &binding.branch,
            sha: content_sha,
        };
        let _: serde_json::Value = github_put(&client, &github_content_url(&binding, &relative_path), &body)?;
    }

    binding.last_sync_commit_sha = Some(branch_head_sha(&client, &binding)?);
    binding.last_sync_at = Some(now_unix_seconds());
    binding.manifest = local_manifest(&binding.workspace_ref)?;
    let mut bindings = read_bindings(&app)?;
    bindings.insert(binding.workspace_ref.clone(), binding);
    write_bindings(&app, &bindings)?;

    repository_get_sync_status(app, request)
}

#[tauri::command]
fn repository_pull_workspace(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
) -> Result<RepositorySyncStatusDto, String> {
    if request.dirty {
        return Err("Save current document before pulling.".to_owned());
    }

    let mut binding = read_binding(&app, &request.workspace_ref)?
        .ok_or_else(|| "Link this workspace to a GitHub repository before pulling.".to_owned())?;
    let token = github_token()?;
    let client = github_client(&token)?;
    let local_manifest_before_pull = local_manifest(&binding.workspace_ref)?;
    let remote_files = github_remote_files(&client, &binding)?;
    let conflicts = remote_files
        .iter()
        .filter(|(path, remote_digest)| {
            let last_digest = binding.manifest.get(*path);
            let local_digest = local_manifest_before_pull.get(*path);
            local_digest.is_some() && local_digest != last_digest && Some(*remote_digest) != last_digest
        })
        .map(|(path, _)| path)
        .cloned()
        .collect::<Vec<_>>();

    if !conflicts.is_empty() {
        return Ok(RepositorySyncStatusDto {
            account: read_account(&app)?,
            binding: Some(binding),
            local_changes: local_manifest_before_pull
                .iter()
                .filter(|(path, digest)| remote_files.get(*path) != Some(*digest))
                .count(),
            remote_changed: true,
            conflicts,
        });
    }

    for relative_path in remote_files.keys() {
        let content = github_download_file(&client, &binding, relative_path)?;
        let destination = workspace_path(&binding.workspace_ref, relative_path)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(destination, content).map_err(|error| error.to_string())?;
    }

    binding.last_sync_commit_sha = Some(branch_head_sha(&client, &binding)?);
    binding.last_sync_at = Some(now_unix_seconds());
    binding.manifest = local_manifest(&binding.workspace_ref)?;
    let mut bindings = read_bindings(&app)?;
    bindings.insert(binding.workspace_ref.clone(), binding);
    write_bindings(&app, &bindings)?;

    repository_get_sync_status(app, request)
}

#[tauri::command]
fn repository_sync_now(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
) -> Result<RepositorySyncStatusDto, String> {
    let pull_status = repository_pull_workspace(app.clone(), WorkspaceSyncRequest {
        workspace_ref: request.workspace_ref.clone(),
        dirty: request.dirty,
    })?;

    if !pull_status.conflicts.is_empty() {
        return Ok(pull_status);
    }

    repository_push_workspace(app, request)
}

fn github_content_sha(
    client: &Client,
    binding: &RepositoryBindingDto,
    relative_path: &str,
) -> Result<Option<String>, String> {
    let response = client
        .get(github_content_url(binding, relative_path))
        .query(&[("ref", binding.branch.as_str())])
        .send()
        .map_err(|error| error.to_string())?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    Ok(Some(
        response
            .error_for_status()
            .map_err(|error| error.to_string())?
            .json::<GithubContentResponse>()
            .map_err(|error| error.to_string())?
            .sha,
    ))
}

fn github_download_file(
    client: &Client,
    binding: &RepositoryBindingDto,
    relative_path: &str,
) -> Result<Vec<u8>, String> {
    let content = client
        .get(github_content_url(binding, relative_path))
        .query(&[("ref", binding.branch.as_str())])
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<GithubContentResponse>()
        .map_err(|error| error.to_string())?;

    if content.encoding.as_deref() != Some("base64") {
        return Err("GitHub returned unsupported file encoding.".to_owned());
    }

    let encoded = content
        .content
        .ok_or_else(|| "GitHub content response did not include content.".to_owned())?
        .replace('\n', "");
    BASE64.decode(encoded).map_err(|error| error.to_string())
}

fn github_remote_files(
    client: &Client,
    binding: &RepositoryBindingDto,
) -> Result<BTreeMap<String, String>, String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
        binding.owner,
        binding.repo,
        urlencoding::encode(&binding.branch)
    );
    let tree = github_get::<GithubTreeResponse>(client, &url)?;
    let remote_root = binding.remote_path.trim_matches('/');
    let mut files = BTreeMap::new();

    for item in tree.tree {
        if item.item_type != "blob" {
            continue;
        }

        let relative_path = if remote_root.is_empty() {
            item.path
        } else if let Some(path) = item.path.strip_prefix(&format!("{remote_root}/")) {
            path.to_owned()
        } else {
            continue;
        };

        if allowed_sync_file(Path::new(&relative_path)) {
            let content = github_download_file(client, binding, &relative_path)?;
            files.insert(relative_path, format!("{}:{}", content.len(), BASE64.encode(content)));
        }
    }

    Ok(files)
}

fn clamp_app_zoom(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(MIN_APP_ZOOM, MAX_APP_ZOOM)
    } else {
        DEFAULT_APP_ZOOM
    }
}

fn read_app_zoom(state: &State<'_, AppZoomState>) -> Result<f64, String> {
    state
        .zoom
        .lock()
        .map(|zoom| *zoom)
        .map_err(|_| "Failed to lock app zoom state.".to_owned())
}

#[tauri::command]
fn set_app_zoom(
    window: WebviewWindow,
    state: State<'_, AppZoomState>,
    zoom: f64,
) -> Result<f64, String> {
    let next_zoom = clamp_app_zoom(zoom);

    window
        .set_zoom(next_zoom)
        .map_err(|error| format!("Failed to set WebView zoom: {error}"))?;

    {
        let mut current_zoom = state
            .zoom
            .lock()
            .map_err(|_| "Failed to lock app zoom state.".to_owned())?;
        *current_zoom = next_zoom;
    }

    let _ = window.emit("app-zoom-changed", next_zoom);

    Ok(next_zoom)
}

#[tauri::command]
fn get_app_zoom(state: State<'_, AppZoomState>) -> Result<f64, String> {
    read_app_zoom(&state)
}

#[tauri::command]
fn zoom_app_in(
    window: WebviewWindow,
    state: State<'_, AppZoomState>,
) -> Result<f64, String> {
    let current_zoom = read_app_zoom(&state)?;
    set_app_zoom(window, state, current_zoom + APP_ZOOM_STEP)
}

#[tauri::command]
fn zoom_app_out(
    window: WebviewWindow,
    state: State<'_, AppZoomState>,
) -> Result<f64, String> {
    let current_zoom = read_app_zoom(&state)?;
    set_app_zoom(
        window,
        state,
        (current_zoom - APP_ZOOM_STEP).max(DEFAULT_APP_ZOOM),
    )
}

#[tauri::command]
fn reset_app_zoom(
    window: WebviewWindow,
    state: State<'_, AppZoomState>,
) -> Result<f64, String> {
    set_app_zoom(window, state, DEFAULT_APP_ZOOM)
}

fn main() -> tauri::Result<()> {
    tauri::Builder::default()
        .manage(AppZoomState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            native_pinch::install_native_pinch(app).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_app_zoom,
            get_app_zoom,
            zoom_app_in,
            zoom_app_out,
            reset_app_zoom,
            list_workspace_files,
            load_markdown_file,
            save_markdown_file,
            write_markdown_file,
            create_markdown_file,
            create_workspace_directory,
            rename_entry,
            open_markdown_file,
            reveal_in_file_manager,
            open_external_url,
            move_entry,
            copy_image_asset,
            save_image_asset,
            export_png_file,
            resolve_markdown_asset,
            repository_validate_github_token,
            repository_disconnect_github,
            repository_get_account,
            repository_list_github_repositories,
            repository_link_workspace,
            repository_get_workspace_binding,
            repository_unlink_workspace,
            repository_get_sync_status,
            repository_push_workspace,
            repository_pull_workspace,
            repository_sync_now,
            debug_emit_native_pinch
        ])
        .run(tauri::generate_context!())
}

#[tauri::command]
fn debug_emit_native_pinch(app: tauri::AppHandle) -> Result<(), String> {
    native_pinch::debug_emit_native_pinch(&app)
}

#[cfg(test)]
mod tests {
    use super::{
        create_markdown_file, create_workspace_directory, list_workspace_files, load_markdown_file,
        rename_entry, save_markdown_file,
    };
    use std::fs;

    fn test_workspace_root(test_name: &str) -> String {
        let test_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "polarbear-workspace-test-{}-{}",
            std::process::id(),
            format!("{test_name}-{test_id}")
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
        save_markdown_file(
            root.clone(),
            "docs/guide.md".to_owned(),
            "# Guide\n\nSaved from Polarbear.\n".to_owned(),
        )
        .expect("save markdown file");

        let source =
            load_markdown_file(root.clone(), "docs/guide.md".to_owned()).expect("load markdown");
        let items = list_workspace_files(root).expect("list workspace files");

        assert!(source.contains("Saved from Polarbear"));
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
        assert!(source.contains("Start writing in Polarbear"));
    }
}
