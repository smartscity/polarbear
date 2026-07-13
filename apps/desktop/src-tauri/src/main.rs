use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

mod app_zoom;
mod cloud_sync_store;
mod ipc_contracts;
mod native_pinch;
mod secret_store;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectRepositoryProviderRequest {
    provider: String,
    token: String,
    base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkWorkspaceRequest {
    workspace_ref: String,
    provider: Option<String>,
    owner: String,
    repo: String,
    branch: String,
    remote_path: String,
    base_url: Option<String>,
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
    base_url: Option<String>,
    connected_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepositoryInfoDto {
    provider: String,
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
    base_url: Option<String>,
    last_sync_commit_sha: Option<String>,
    last_sync_at: Option<i64>,
    #[serde(default)]
    has_synced: bool,
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepositorySyncProgressDto {
    phase: String,
    message: String,
    current: Option<usize>,
    total: Option<usize>,
}

fn emit_repository_sync_progress(
    app: &tauri::AppHandle,
    phase: &str,
    message: impl Into<String>,
    current: Option<usize>,
    total: Option<usize>,
) {
    let message = message.into();
    let _ = app.emit(
        ipc_contracts::REPOSITORY_SYNC_PROGRESS_EVENT,
        RepositorySyncProgressDto {
            phase: phase.to_owned(),
            message: message.clone(),
            current,
            total,
        },
    );
    if let Ok(database_path) = cloud_sync_database_path(app) {
        let _ = cloud_sync_store::append_active_run_event(
            &database_path,
            phase,
            &message,
            current,
            total,
        );
    }
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

#[derive(Debug, Deserialize)]
struct GithubCompareResponse {
    #[serde(default)]
    files: Vec<GithubCompareFileResponse>,
}

#[derive(Debug, Deserialize)]
struct GithubCompareFileResponse {
    filename: String,
    status: String,
    previous_filename: Option<String>,
}

#[derive(Debug, Serialize)]
struct GithubPutContentRequest<'a> {
    message: &'a str,
    content: String,
    branch: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha: Option<String>,
}

#[derive(Debug, Serialize)]
struct GithubDeleteContentRequest<'a> {
    message: &'a str,
    branch: &'a str,
    sha: String,
}

#[derive(Debug, Deserialize)]
struct GitlabUserResponse {
    id: u64,
    username: String,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitlabProjectResponse {
    path: String,
    path_with_namespace: String,
    default_branch: Option<String>,
    visibility: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitlabBranchResponse {
    commit: GitlabCommitRef,
}

#[derive(Debug, Deserialize)]
struct GitlabCommitRef {
    id: String,
}

#[derive(Debug, Deserialize)]
struct GitlabTreeItemResponse {
    path: String,
    #[serde(rename = "type")]
    item_type: String,
}

#[derive(Debug, Deserialize)]
struct GitlabCompareResponse {
    #[serde(default)]
    diffs: Vec<GitlabCompareDiffResponse>,
    #[serde(default)]
    compare_timeout: bool,
}

#[derive(Debug, Deserialize)]
struct GitlabCompareDiffResponse {
    old_path: String,
    new_path: String,
    #[serde(default)]
    renamed_file: bool,
    #[serde(default)]
    deleted_file: bool,
}

#[derive(Debug, Serialize)]
struct GitlabCommitRequest<'a> {
    branch: &'a str,
    commit_message: &'a str,
    actions: Vec<GitlabCommitAction>,
}

#[derive(Debug, Serialize)]
struct GitlabCommitAction {
    action: String,
    file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    encoding: Option<String>,
}

#[derive(Default)]
struct RemoteChangeSet {
    changed_paths: BTreeSet<String>,
    deleted_paths: BTreeSet<String>,
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

fn cloud_sync_database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join("cloud-sync.sqlite3"))
}

fn read_account(app: &tauri::AppHandle) -> Result<Option<RepositoryAccountDto>, String> {
    let path = account_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|error| error.to_string())
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
    cloud_sync_store::load_bindings(&cloud_sync_database_path(app)?, &bindings_path(app)?)
}

fn write_bindings(
    app: &tauri::AppHandle,
    bindings: &BTreeMap<String, RepositoryBindingDto>,
) -> Result<(), String> {
    cloud_sync_store::replace_bindings(&cloud_sync_database_path(app)?, bindings)
}

fn read_binding(
    app: &tauri::AppHandle,
    workspace_ref: &str,
) -> Result<Option<RepositoryBindingDto>, String> {
    Ok(read_bindings(app)?.get(workspace_ref).cloned())
}

fn github_client(token: &str) -> Result<Client, String> {
    Client::builder()
        .user_agent("Polarbear")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
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

fn normalize_repository_provider(provider: &str) -> Result<String, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "github" => Ok("github".to_owned()),
        "gitlab" => Ok("gitlab".to_owned()),
        _ => Err("Supported repository providers are GitHub and GitLab.".to_owned()),
    }
}

fn repository_provider_label(provider: &str) -> &'static str {
    match provider {
        "gitlab" => "GitLab",
        _ => "GitHub",
    }
}

fn repository_token(app: &tauri::AppHandle, provider: &str) -> Result<String, String> {
    let provider = normalize_repository_provider(provider)?;
    secret_store::read_repository_secret(app, &provider)?.ok_or_else(|| {
        format!(
            "Connect {} before using repository sync.",
            repository_provider_label(&provider)
        )
    })
}

fn read_connected_account(app: &tauri::AppHandle) -> Result<Option<RepositoryAccountDto>, String> {
    let Some(account) = read_account(app)? else {
        return Ok(None);
    };
    let provider = normalize_repository_provider(&account.provider)?;
    let secret = secret_store::read_repository_secret(app, &provider)?;
    if secret
        .as_deref()
        .is_some_and(|token| !token.trim().is_empty())
    {
        return Ok(Some(account));
    }

    delete_account(app)?;
    Ok(None)
}

fn normalize_gitlab_base_url(base_url: Option<&str>) -> String {
    let trimmed = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("https://gitlab.com");
    trimmed.trim_end_matches('/').to_owned()
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

fn github_api_error(response: reqwest::blocking::Response, operation: &str) -> String {
    let status = response.status();
    let request_id = response
        .headers()
        .get("x-github-request-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let body = response.text().unwrap_or_default();
    let github_message = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|json| json.get("message")?.as_str().map(str::to_owned))
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| status.to_string());
    let request_suffix = if request_id.is_empty() {
        String::new()
    } else {
        format!(" GitHub request: {request_id}.")
    };

    if status == reqwest::StatusCode::FORBIDDEN {
        return format!(
            "GitHub denied {operation}. Edit the fine-grained token and set Repository permissions > Contents to Read and write. Repository access and Workflows permission alone are not sufficient. GitHub response: {github_message}.{request_suffix}"
        );
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return format!(
            "GitHub rejected the token while attempting to {operation}. Reconnect Cloud Sync with a valid token.{request_suffix}"
        );
    }

    format!("GitHub could not {operation}: {github_message} ({status}).{request_suffix}")
}

fn github_put<T: Serialize, R: for<'de> Deserialize<'de>>(
    client: &Client,
    url: &str,
    body: &T,
) -> Result<R, String> {
    let response = client
        .put(url)
        .json(body)
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(github_api_error(response, "upload repository contents"));
    }
    response.json::<R>().map_err(|error| error.to_string())
}

fn github_delete<T: Serialize, R: for<'de> Deserialize<'de>>(
    client: &Client,
    url: &str,
    body: &T,
) -> Result<R, String> {
    let response = client
        .delete(url)
        .json(body)
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(github_api_error(response, "delete repository contents"));
    }
    response.json::<R>().map_err(|error| error.to_string())
}

fn gitlab_client(token: &str) -> Result<Client, String> {
    Client::builder()
        .user_agent("Polarbear")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                reqwest::header::HeaderName::from_static("private-token"),
                reqwest::header::HeaderValue::from_str(token).map_err(|error| error.to_string())?,
            );
            headers
        })
        .build()
        .map_err(|error| error.to_string())
}

fn gitlab_api_base(base_url: Option<&str>) -> String {
    format!("{}/api/v4", normalize_gitlab_base_url(base_url))
}

fn gitlab_project_path(owner: &str, repo: &str) -> String {
    if owner.trim().is_empty() {
        repo.to_owned()
    } else {
        format!("{owner}/{repo}")
    }
}

fn gitlab_project_id(binding: &RepositoryBindingDto) -> String {
    urlencoding::encode(&gitlab_project_path(&binding.owner, &binding.repo)).to_string()
}

fn gitlab_file_id(path: &str) -> String {
    urlencoding::encode(path).to_string()
}

fn gitlab_get<T: for<'de> Deserialize<'de>>(client: &Client, url: &str) -> Result<T, String> {
    client
        .get(url)
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<T>()
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

fn gitlab_branch_head_sha(
    client: &Client,
    binding: &RepositoryBindingDto,
) -> Result<String, String> {
    let url = format!(
        "{}/projects/{}/repository/branches/{}",
        gitlab_api_base(binding.base_url.as_deref()),
        gitlab_project_id(binding),
        urlencoding::encode(&binding.branch)
    );
    Ok(gitlab_get::<GitlabBranchResponse>(client, &url)?.commit.id)
}

fn provider_branch_head_sha(
    app: &tauri::AppHandle,
    binding: &RepositoryBindingDto,
) -> Result<String, String> {
    match normalize_repository_provider(&binding.provider)?.as_str() {
        "gitlab" => {
            let token = repository_token(app, "gitlab")?;
            let client = gitlab_client(&token)?;
            gitlab_branch_head_sha(&client, binding)
        }
        _ => {
            let token = repository_token(app, "github")?;
            let client = github_client(&token)?;
            branch_head_sha(&client, binding)
        }
    }
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
                "md" | "markdown"
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
    Ok(content_digest(&bytes))
}

fn content_digest(content: &[u8]) -> String {
    format!("{}:{}", content.len(), BASE64.encode(content))
}

fn content_revision(content: &[u8]) -> String {
    // A revision detects accidental concurrent writes without exposing document content in the token.
    let hash = content.iter().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x1000_0000_01b3)
    });
    format!("{}-{hash:016x}", content.len())
}

fn local_manifest(
    app: &tauri::AppHandle,
    workspace_root: &str,
) -> Result<BTreeMap<String, String>, String> {
    Ok(local_snapshot(app, workspace_root)?.1)
}

fn local_snapshot(
    app: &tauri::AppHandle,
    workspace_root: &str,
) -> Result<(BTreeMap<String, PathBuf>, BTreeMap<String, String>), String> {
    let root = PathBuf::from(workspace_root);
    let files = scan_sync_files(&root, &root)?;
    let database_path = cloud_sync_database_path(app)?;
    let cached_files = cloud_sync_store::read_local_file_cache(&database_path, workspace_root)?;
    let mut manifest = BTreeMap::new();
    let mut cache_entries = Vec::with_capacity(files.len());

    for (relative_path, path) in &files {
        let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
        let size = i64::try_from(metadata.len()).unwrap_or(i64::MAX);
        let modified_ns = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| i64::try_from(duration.as_nanos()).unwrap_or(i64::MAX))
            .unwrap_or_default();
        let cached_digest = cached_files
            .get(relative_path)
            .filter(|cached| cached.size == size && cached.modified_ns == modified_ns)
            .map(|cached| cached.digest.clone());
        let digest = match cached_digest {
            Some(digest) => digest,
            None => file_digest(path)?,
        };
        manifest.insert(relative_path.clone(), digest.clone());
        cache_entries.push(cloud_sync_store::LocalFileCacheEntry {
            relative_path: relative_path.clone(),
            size,
            modified_ns,
            digest,
        });
    }
    cloud_sync_store::replace_local_file_cache(&database_path, workspace_root, &cache_entries)?;

    Ok((files, manifest))
}

fn manifest_change_count(
    current_manifest: &BTreeMap<String, String>,
    baseline_manifest: &BTreeMap<String, String>,
) -> usize {
    let changed_or_added = current_manifest
        .iter()
        .filter(|(path, digest)| baseline_manifest.get(*path) != Some(*digest))
        .count();
    let deleted = baseline_manifest
        .keys()
        .filter(|path| !current_manifest.contains_key(*path))
        .count();
    changed_or_added + deleted
}

fn update_sync_outbox(
    app: &tauri::AppHandle,
    binding: &RepositoryBindingDto,
    local_manifest: &BTreeMap<String, String>,
) -> Result<(), String> {
    let operations = local_manifest
        .iter()
        .filter(|(path, digest)| binding.manifest.get(*path) != Some(*digest))
        .map(|(path, _)| (path.clone(), "upload".to_owned()))
        .chain(
            binding
                .manifest
                .keys()
                .filter(|path| !local_manifest.contains_key(*path))
                .map(|path| (path.clone(), "delete".to_owned())),
        )
        .collect::<Vec<_>>();
    cloud_sync_store::replace_outbox(
        &cloud_sync_database_path(app)?,
        &binding.workspace_ref,
        &operations,
    )
}

fn remote_manifest_changed(
    remote_manifest: &BTreeMap<String, String>,
    baseline_manifest: &BTreeMap<String, String>,
) -> bool {
    manifest_change_count(remote_manifest, baseline_manifest) > 0
}

fn remote_path_for(binding: &RepositoryBindingDto, relative_path: &str) -> String {
    let remote_root = binding.remote_path.trim_matches('/');
    if remote_root.is_empty() {
        relative_path.to_owned()
    } else {
        format!("{remote_root}/{relative_path}")
    }
}

fn relative_sync_path(binding: &RepositoryBindingDto, repository_path: &str) -> Option<String> {
    let remote_root = binding.remote_path.trim_matches('/');
    let relative_path = if remote_root.is_empty() {
        repository_path.to_owned()
    } else {
        repository_path
            .strip_prefix(&format!("{remote_root}/"))?
            .to_owned()
    };

    allowed_sync_file(Path::new(&relative_path)).then_some(relative_path)
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
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(MarkdownFileRevisionDto {
                exists: false,
                watch_token: None,
            })
        }
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
    let saved = save_markdown_file_content(
        &workspace_root,
        &relative_path,
        &markdown_content,
        expected_revision.as_deref(),
    )?;
    if read_binding(&app, &workspace_root)
        .map_err(WorkspaceSaveError::unexpected)?
        .is_some()
    {
        cloud_sync_store::queue_outbox_path(
            &cloud_sync_database_path(&app).map_err(WorkspaceSaveError::unexpected)?,
            &workspace_root,
            &relative_path,
            "upload",
        )
        .map_err(WorkspaceSaveError::unexpected)?;
    }
    Ok(saved)
}

fn save_markdown_file_content(
    workspace_root: &str,
    relative_path: &str,
    markdown_content: &str,
    expected_revision: Option<&str>,
) -> Result<MarkdownSaveResponseDto, WorkspaceSaveError> {
    let path = workspace_path(workspace_root, relative_path).map_err(WorkspaceSaveError::unexpected)?;

    if !is_markdown_file(&path) {
        return Err(WorkspaceSaveError::unexpected("Only Markdown files can be saved."));
    }

    let current_content = fs::read(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            WorkspaceSaveError::document_missing()
        } else {
            WorkspaceSaveError::unexpected(error.to_string())
        }
    })?;
    if let Some(expected_revision) = expected_revision {
        if content_revision(&current_content) != expected_revision {
            return Err(WorkspaceSaveError::document_changed());
        }
    }

    atomic_write(&path, markdown_content.as_bytes()).map_err(WorkspaceSaveError::unexpected)?;
    Ok(MarkdownSaveResponseDto {
        revision: content_revision(markdown_content.as_bytes()),
    })
}

#[tauri::command]
fn write_markdown_file(
    file_path: String,
    markdown_content: String,
    expected_revision: Option<String>,
) -> Result<MarkdownSaveResponseDto, WorkspaceSaveError> {
    let path = PathBuf::from(file_path);

    if !is_markdown_file(&path) {
        return Err(WorkspaceSaveError::unexpected("Only Markdown files can be saved."));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| WorkspaceSaveError::unexpected(error.to_string()))?;
    }

    if let Some(expected_revision) = expected_revision {
        let current_content = fs::read(&path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                WorkspaceSaveError::document_missing()
            } else {
                WorkspaceSaveError::unexpected(error.to_string())
            }
        })?;
        if content_revision(&current_content) != expected_revision {
            return Err(WorkspaceSaveError::document_changed());
        }
    }

    atomic_write(&path, markdown_content.as_bytes()).map_err(WorkspaceSaveError::unexpected)?;
    Ok(MarkdownSaveResponseDto {
        revision: content_revision(markdown_content.as_bytes()),
    })
}

fn read_markdown_document(path: &Path) -> Result<MarkdownDocumentDto, String> {
    let markdown_content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    Ok(MarkdownDocumentDto {
        revision: content_revision(markdown_content.as_bytes()),
        markdown_content,
    })
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The target file does not have a parent directory.".to_owned())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The target file name is invalid.".to_owned())?;
    let temporary_path = parent.join(format!(
        ".{file_name}.polarbear-{}-{}.tmp",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default(),
    ));

    let result = (|| -> Result<(), String> {
        let mut temporary_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|error| error.to_string())?;
        temporary_file
            .write_all(content)
            .map_err(|error| error.to_string())?;
        temporary_file
            .sync_all()
            .map_err(|error| error.to_string())?;
        fs::rename(&temporary_path, path).map_err(|error| error.to_string())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    result
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

    atomic_write(&path, b"# Untitled\n\nStart writing in Polarbear.\n")
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

fn github_repositories(client: &Client) -> Result<Vec<RepositoryInfoDto>, String> {
    let mut page = 1;
    let mut repositories = Vec::new();

    loop {
        let repos = github_get::<Vec<GithubRepoResponse>>(
            client,
            &format!("https://api.github.com/user/repos?per_page=100&sort=updated&page={page}"),
        )?;
        let repo_count = repos.len();
        repositories.extend(repos.into_iter().map(|repo| RepositoryInfoDto {
            provider: "github".to_owned(),
            owner: repo.owner.login,
            name: repo.name,
            full_name: repo.full_name,
            default_branch: repo.default_branch,
            private: repo.private,
        }));

        if repo_count < 100 {
            break;
        }
        page += 1;
    }

    Ok(repositories)
}

fn gitlab_repositories(
    client: &Client,
    base_url: Option<&str>,
) -> Result<Vec<RepositoryInfoDto>, String> {
    let projects = gitlab_get::<Vec<GitlabProjectResponse>>(
        client,
        &format!(
            "{}/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at",
            gitlab_api_base(base_url)
        ),
    )?;

    Ok(projects
        .into_iter()
        .map(|project| {
            let owner = project
                .path_with_namespace
                .rsplit_once('/')
                .map(|(owner, _)| owner.to_owned())
                .unwrap_or_default();
            RepositoryInfoDto {
                provider: "gitlab".to_owned(),
                owner,
                name: project.path,
                full_name: project.path_with_namespace,
                default_branch: project.default_branch.unwrap_or_else(|| "main".to_owned()),
                private: project.visibility.as_deref() != Some("public"),
            }
        })
        .collect())
}

async fn run_repository_task<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Cloud Sync background task failed: {error}"))?
}

fn run_tracked_repository_operation<T, F>(
    app: &tauri::AppHandle,
    workspace_ref: &str,
    operation: &str,
    task: F,
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let database_path = cloud_sync_database_path(app)?;
    let run_id = cloud_sync_store::begin_sync_run(&database_path, workspace_ref, operation)?;
    let result = task();
    let (status, error) = match &result {
        Ok(_) => ("completed", None),
        Err(error) => ("failed", Some(error.as_str())),
    };
    let _ = cloud_sync_store::finish_sync_run(&database_path, run_id, status, error);
    result
}

fn repository_connect_provider_blocking(
    app: tauri::AppHandle,
    request: ConnectRepositoryProviderRequest,
) -> Result<RepositoryAccountDto, String> {
    let provider = normalize_repository_provider(&request.provider)?;
    let token = request.token.trim();
    if token.is_empty() {
        return Err(format!(
            "{} token cannot be empty.",
            repository_provider_label(&provider)
        ));
    }

    let account = if provider == "gitlab" {
        let base_url = normalize_gitlab_base_url(request.base_url.as_deref());
        let client = gitlab_client(token)?;
        let user = gitlab_get::<GitlabUserResponse>(
            &client,
            &format!("{}/user", gitlab_api_base(Some(base_url.as_str()))),
        )?;
        secret_store::save_repository_secret(&app, &provider, token)?;
        RepositoryAccountDto {
            provider,
            account_id: user.id.to_string(),
            login: user.username,
            avatar_url: user.avatar_url,
            base_url: Some(base_url),
            connected_at: now_unix_seconds(),
        }
    } else {
        let client = github_client(token)?;
        let user = github_get::<GithubUserResponse>(&client, "https://api.github.com/user")?;
        secret_store::save_repository_secret(&app, &provider, token)?;
        RepositoryAccountDto {
            provider,
            account_id: user.id.to_string(),
            login: user.login,
            avatar_url: user.avatar_url,
            base_url: None,
            connected_at: now_unix_seconds(),
        }
    };

    let saved_token =
        secret_store::read_repository_secret(&app, &account.provider)?.ok_or_else(|| {
            "Cloud Sync could not save the token. Check app storage permissions and try again."
                .to_owned()
        })?;
    if saved_token != token {
        return Err("Cloud Sync could not verify the saved token.".to_owned());
    }

    write_account(&app, &account)?;
    Ok(account)
}

#[tauri::command]
async fn repository_connect_provider(
    app: tauri::AppHandle,
    request: ConnectRepositoryProviderRequest,
) -> Result<RepositoryAccountDto, String> {
    run_repository_task(move || repository_connect_provider_blocking(app, request)).await
}

#[tauri::command]
fn repository_disconnect_provider(app: tauri::AppHandle) -> Result<(), String> {
    secret_store::delete_repository_secrets(&app)?;
    delete_account(&app)
}

#[tauri::command]
fn repository_get_account(app: tauri::AppHandle) -> Result<Option<RepositoryAccountDto>, String> {
    read_connected_account(&app)
}

fn repository_list_repositories_blocking(
    app: tauri::AppHandle,
) -> Result<Vec<RepositoryInfoDto>, String> {
    let account = read_connected_account(&app)?.ok_or_else(|| {
        "Cloud Sync credentials are missing. Connect Cloud Sync again.".to_owned()
    })?;
    let provider = normalize_repository_provider(&account.provider)?;
    let token = repository_token(&app, &provider)?;
    if provider == "gitlab" {
        let client = gitlab_client(&token)?;
        gitlab_repositories(&client, account.base_url.as_deref())
    } else {
        let client = github_client(&token)?;
        github_repositories(&client)
    }
}

#[tauri::command]
async fn repository_list_repositories(
    app: tauri::AppHandle,
) -> Result<Vec<RepositoryInfoDto>, String> {
    run_repository_task(move || repository_list_repositories_blocking(app)).await
}

fn repository_link_workspace_blocking(
    app: tauri::AppHandle,
    request: LinkWorkspaceRequest,
) -> Result<RepositoryBindingDto, String> {
    if request.workspace_ref.trim().is_empty() {
        return Err("Open a workspace before linking a repository.".to_owned());
    }

    let account = read_account(&app)?
        .ok_or_else(|| "Connect a repository provider before linking.".to_owned())?;
    let provider = normalize_repository_provider(
        request
            .provider
            .as_deref()
            .unwrap_or(account.provider.as_str()),
    )?;
    let mut binding = RepositoryBindingDto {
        workspace_ref: request.workspace_ref,
        provider,
        owner: request.owner,
        repo: request.repo,
        branch: request.branch,
        remote_path: request.remote_path,
        base_url: request.base_url.or(account.base_url),
        last_sync_commit_sha: None,
        last_sync_at: None,
        has_synced: false,
        manifest: BTreeMap::new(),
    };
    let head_sha = provider_branch_head_sha(&app, &binding)?;
    let remote_manifest = provider_remote_files(&app, &binding)?;
    binding.last_sync_commit_sha = Some(head_sha);
    binding.last_sync_at = None;
    binding.manifest = remote_manifest;

    let mut bindings = read_bindings(&app)?;
    bindings.insert(binding.workspace_ref.clone(), binding.clone());
    write_bindings(&app, &bindings)?;
    Ok(binding)
}

#[tauri::command]
async fn repository_link_workspace(
    app: tauri::AppHandle,
    request: LinkWorkspaceRequest,
) -> Result<RepositoryBindingDto, String> {
    run_repository_task(move || repository_link_workspace_blocking(app, request)).await
}

#[tauri::command]
fn repository_get_workspace_binding(
    app: tauri::AppHandle,
    workspace_ref: String,
) -> Result<Option<RepositoryBindingDto>, String> {
    read_binding(&app, &workspace_ref)
}

fn repository_get_sync_status_blocking(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
) -> Result<RepositorySyncStatusDto, String> {
    let account = read_account(&app)?;
    let binding = read_binding(&app, &request.workspace_ref)?;
    let local_changes = match binding.as_ref() {
        Some(binding) => {
            let current_manifest = local_manifest(&app, &binding.workspace_ref)?;
            manifest_change_count(&current_manifest, &binding.manifest)
        }
        None => 0,
    };
    let remote_changed = match binding.as_ref() {
        Some(binding) => {
            let head_changed = binding.last_sync_commit_sha.as_deref()
                != Some(&provider_branch_head_sha(&app, binding)?);
            if head_changed {
                true
            } else if binding.has_synced {
                false
            } else {
                let remote_manifest = provider_remote_files(&app, binding)?;
                remote_manifest_changed(&remote_manifest, &binding.manifest)
            }
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
async fn repository_get_sync_status(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
) -> Result<RepositorySyncStatusDto, String> {
    run_repository_task(move || repository_get_sync_status_blocking(app, request)).await
}

fn repository_push_workspace_blocking(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
    remote_already_checked: bool,
) -> Result<RepositorySyncStatusDto, String> {
    if request.dirty {
        return Err("Save current document before pushing.".to_owned());
    }

    let mut binding = read_binding(&app, &request.workspace_ref)?
        .ok_or_else(|| "Link this workspace to a repository before pushing.".to_owned())?;
    let had_synced = binding.has_synced;
    let queued_operations =
        cloud_sync_store::read_outbox(&cloud_sync_database_path(&app)?, &binding.workspace_ref)?;
    let checked_remote_head = if remote_already_checked {
        None
    } else {
        emit_repository_sync_progress(
            &app,
            "check-remote",
            "Checking whether the remote branch changed...",
            None,
            None,
        );
        let remote_head = provider_branch_head_sha(&app, &binding)?;
        if binding.last_sync_commit_sha.as_deref() != Some(remote_head.as_str()) {
            emit_repository_sync_progress(
                &app,
                "remote-changed",
                "Remote changed; merging untouched files before uploading local changes...",
                None,
                None,
            );
            repository_pull_workspace_internal(
                app.clone(),
                WorkspaceSyncRequest {
                    workspace_ref: request.workspace_ref.clone(),
                    dirty: request.dirty,
                },
                false,
                Some(remote_head),
            )?;
            return repository_push_workspace_blocking(app, request, true);
        }
        Some(remote_head)
    };
    emit_repository_sync_progress(
        &app,
        "scan-local",
        "Scanning local workspace for changes...",
        None,
        None,
    );
    let (mut files, local_manifest) = local_snapshot(&app, &binding.workspace_ref)?;
    emit_repository_sync_progress(
        &app,
        "scan-local-complete",
        format!("Found {} local sync file(s).", local_manifest.len()),
        Some(local_manifest.len()),
        Some(local_manifest.len()),
    );
    let remote_files_before_push = binding.manifest.clone();

    files.retain(|path, _| remote_files_before_push.get(path) != local_manifest.get(path));
    let deleted_paths = binding
        .manifest
        .keys()
        .filter(|path| {
            !local_manifest.contains_key(*path)
                && remote_files_before_push.contains_key(*path)
                && (binding.has_synced
                    || queued_operations.get(*path).map(String::as_str) == Some("delete"))
        })
        .cloned()
        .collect::<Vec<_>>();
    let remote_changed = !had_synced
        && remote_files_before_push
            .keys()
            .any(|path| !local_manifest.contains_key(path));
    update_sync_outbox(&app, &binding, &local_manifest)?;

    if files.is_empty() && deleted_paths.is_empty() {
        emit_repository_sync_progress(
            &app,
            "up-to-date",
            "No local changes need to be uploaded.",
            Some(0),
            Some(0),
        );
        if let Some(remote_head) = checked_remote_head {
            binding.last_sync_commit_sha = Some(remote_head);
        }
        binding.last_sync_at = Some(now_unix_seconds());
        binding.has_synced = had_synced || !remote_changed;
        binding.manifest = local_manifest;
        let mut bindings = read_bindings(&app)?;
        bindings.insert(binding.workspace_ref.clone(), binding.clone());
        write_bindings(&app, &bindings)?;
        cloud_sync_store::clear_outbox(&cloud_sync_database_path(&app)?, &binding.workspace_ref)?;
        return Ok(RepositorySyncStatusDto {
            account: read_connected_account(&app)?,
            binding: Some(binding),
            local_changes: 0,
            remote_changed,
            conflicts: Vec::new(),
        });
    }

    provider_push_workspace_files(
        &app,
        &binding,
        &files,
        &deleted_paths,
        &remote_files_before_push,
    )?;

    emit_repository_sync_progress(
        &app,
        "save-state",
        "Saving the new sync state...",
        None,
        None,
    );
    binding.last_sync_commit_sha = Some(provider_branch_head_sha(&app, &binding)?);
    binding.last_sync_at = Some(now_unix_seconds());
    binding.has_synced = had_synced || !remote_changed;
    binding.manifest = local_manifest;
    let mut bindings = read_bindings(&app)?;
    bindings.insert(binding.workspace_ref.clone(), binding.clone());
    write_bindings(&app, &bindings)?;
    cloud_sync_store::clear_outbox(&cloud_sync_database_path(&app)?, &binding.workspace_ref)?;

    Ok(RepositorySyncStatusDto {
        account: read_connected_account(&app)?,
        binding: Some(binding),
        local_changes: 0,
        remote_changed,
        conflicts: Vec::new(),
    })
}

#[tauri::command]
async fn repository_push_workspace(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
) -> Result<RepositorySyncStatusDto, String> {
    run_repository_task(move || {
        let tracking_app = app.clone();
        let workspace_ref = request.workspace_ref.clone();
        run_tracked_repository_operation(&tracking_app, &workspace_ref, "upload", || {
            repository_push_workspace_blocking(app, request, false)
        })
    })
    .await
}

fn repository_pull_workspace_internal(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
    force_remote: bool,
    known_remote_head: Option<String>,
) -> Result<RepositorySyncStatusDto, String> {
    if request.dirty {
        return Err("Save current document before pulling.".to_owned());
    }

    let mut binding = read_binding(&app, &request.workspace_ref)?
        .ok_or_else(|| "Link this workspace to a repository before pulling.".to_owned())?;
    emit_repository_sync_progress(
        &app,
        "scan-local",
        "Scanning local workspace before merging...",
        None,
        None,
    );
    let local_manifest_before_pull = local_manifest(&app, &binding.workspace_ref)?;
    update_sync_outbox(&app, &binding, &local_manifest_before_pull)?;
    emit_repository_sync_progress(
        &app,
        "scan-local-complete",
        format!(
            "Found {} local sync file(s).",
            local_manifest_before_pull.len()
        ),
        Some(local_manifest_before_pull.len()),
        Some(local_manifest_before_pull.len()),
    );
    emit_repository_sync_progress(
        &app,
        "read-remote",
        "Comparing remote commits for changed files...",
        None,
        None,
    );
    let remote_head = match known_remote_head {
        Some(remote_head) => remote_head,
        None => provider_branch_head_sha(&app, &binding)?,
    };
    let remote_changes = provider_remote_changes_since(&app, &binding, &remote_head)?;
    let mut remote_manifest = binding.manifest.clone();
    for relative_path in &remote_changes.deleted_paths {
        remote_manifest.remove(relative_path);
    }
    for relative_path in &remote_changes.changed_paths {
        remote_manifest
            .entry(relative_path.clone())
            .or_insert_with(|| "remote-file-needs-refresh".to_owned());
    }
    let mut current_remote_paths = remote_manifest.keys().cloned().collect::<BTreeSet<_>>();
    current_remote_paths.extend(remote_changes.changed_paths.iter().cloned());

    let paths_to_consider = if force_remote {
        current_remote_paths
            .iter()
            .chain(local_manifest_before_pull.keys())
            .cloned()
            .collect::<BTreeSet<_>>()
    } else if !binding.has_synced {
        current_remote_paths
            .iter()
            .chain(remote_changes.deleted_paths.iter())
            .cloned()
            .collect::<BTreeSet<_>>()
    } else {
        remote_changes
            .changed_paths
            .iter()
            .chain(remote_changes.deleted_paths.iter())
            .cloned()
            .collect::<BTreeSet<_>>()
    };

    let changed_remote_total = paths_to_consider.len();
    let mut changed_index = 0;
    for relative_path in paths_to_consider {
        let baseline_digest = binding.manifest.get(&relative_path);
        let local_digest = local_manifest_before_pull.get(&relative_path);
        let remote_exists = current_remote_paths.contains(&relative_path);
        let remote_changed = remote_changes.changed_paths.contains(&relative_path);
        let remote_deleted = remote_changes.deleted_paths.contains(&relative_path);
        let local_changed = local_digest != baseline_digest;
        let should_apply_remote = if force_remote {
            remote_exists && (remote_changed || local_digest != remote_manifest.get(&relative_path))
        } else if !binding.has_synced {
            remote_exists && local_digest.is_none()
        } else {
            remote_changed && !local_changed
        };
        let should_delete_local = if force_remote {
            local_digest.is_some() && !remote_exists
        } else {
            remote_deleted && !local_changed && local_digest.is_some()
        };

        if !should_apply_remote && !should_delete_local {
            continue;
        }

        changed_index += 1;
        emit_repository_sync_progress(
            &app,
            "apply-remote",
            format!("Applying remote change: {relative_path}"),
            Some(changed_index),
            Some(changed_remote_total),
        );

        let destination = workspace_path(&binding.workspace_ref, &relative_path)?;
        if should_apply_remote {
            let content = provider_download_file(&app, &binding, &relative_path)?;
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            remote_manifest.insert(relative_path, content_digest(&content));
            atomic_write(&destination, &content)?;
        } else if destination.exists() {
            fs::remove_file(destination).map_err(|error| error.to_string())?;
        }
    }

    binding.last_sync_commit_sha = Some(remote_head);
    binding.last_sync_at = Some(now_unix_seconds());
    binding.has_synced = true;
    binding.manifest = remote_manifest;
    let local_manifest_after_pull = local_manifest(&app, &binding.workspace_ref)?;
    let local_changes = manifest_change_count(&local_manifest_after_pull, &binding.manifest);
    update_sync_outbox(&app, &binding, &local_manifest_after_pull)?;
    let mut bindings = read_bindings(&app)?;
    bindings.insert(binding.workspace_ref.clone(), binding.clone());
    write_bindings(&app, &bindings)?;

    Ok(RepositorySyncStatusDto {
        account: read_connected_account(&app)?,
        binding: Some(binding),
        local_changes,
        remote_changed: false,
        conflicts: Vec::new(),
    })
}

#[tauri::command]
async fn repository_pull_workspace(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
) -> Result<RepositorySyncStatusDto, String> {
    run_repository_task(move || {
        let tracking_app = app.clone();
        let workspace_ref = request.workspace_ref.clone();
        run_tracked_repository_operation(&tracking_app, &workspace_ref, "download", || {
            repository_pull_workspace_internal(app, request, true, None)
        })
    })
    .await
}

fn repository_sync_now_blocking(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
) -> Result<RepositorySyncStatusDto, String> {
    emit_repository_sync_progress(
        &app,
        "check-remote",
        "Checking whether the remote branch changed...",
        None,
        None,
    );
    let mut binding = read_binding(&app, &request.workspace_ref)?
        .ok_or_else(|| "Link this workspace to a repository before syncing.".to_owned())?;
    let remote_head = provider_branch_head_sha(&app, &binding)?;
    if binding.last_sync_commit_sha.as_deref() == Some(remote_head.as_str()) {
        emit_repository_sync_progress(
            &app,
            "remote-unchanged",
            "Remote branch is unchanged; skipping the full download scan.",
            None,
            None,
        );
        if !binding.has_synced {
            emit_repository_sync_progress(
                &app,
                "initial-merge",
                "Preparing the initial workspace merge...",
                None,
                None,
            );
            let local_manifest_before_sync = local_manifest(&app, &binding.workspace_ref)?;
            emit_repository_sync_progress(
                &app,
                "scan-local-complete",
                format!(
                    "Found {} local sync file(s).",
                    local_manifest_before_sync.len()
                ),
                Some(local_manifest_before_sync.len()),
                Some(local_manifest_before_sync.len()),
            );
            let missing_remote_paths = binding
                .manifest
                .keys()
                .filter(|path| !local_manifest_before_sync.contains_key(*path))
                .cloned()
                .collect::<Vec<_>>();
            let missing_remote_total = missing_remote_paths.len();
            for (download_index, relative_path) in missing_remote_paths.iter().enumerate() {
                emit_repository_sync_progress(
                    &app,
                    "download",
                    format!("Downloading remote file: {relative_path}"),
                    Some(download_index + 1),
                    Some(missing_remote_total),
                );
                let content = provider_download_file(&app, &binding, relative_path)?;
                let destination = workspace_path(&binding.workspace_ref, relative_path)?;
                if let Some(parent) = destination.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                atomic_write(&destination, &content)?;
            }

            binding.has_synced = true;
            let mut bindings = read_bindings(&app)?;
            bindings.insert(binding.workspace_ref.clone(), binding);
            write_bindings(&app, &bindings)?;
        }
        return repository_push_workspace_blocking(app, request, true);
    }

    emit_repository_sync_progress(
        &app,
        "remote-changed",
        "Remote branch changed; starting a safe merge...",
        None,
        None,
    );

    let pull_status = repository_pull_workspace_internal(
        app.clone(),
        WorkspaceSyncRequest {
            workspace_ref: request.workspace_ref.clone(),
            dirty: request.dirty,
        },
        false,
        Some(remote_head),
    )?;

    if !pull_status.conflicts.is_empty() {
        return Ok(pull_status);
    }

    repository_push_workspace_blocking(app, request, true)
}

#[tauri::command]
async fn repository_sync_now(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
) -> Result<RepositorySyncStatusDto, String> {
    run_repository_task(move || {
        let tracking_app = app.clone();
        let workspace_ref = request.workspace_ref.clone();
        run_tracked_repository_operation(&tracking_app, &workspace_ref, "sync", || {
            repository_sync_now_blocking(app, request)
        })
    })
    .await
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
    app: &tauri::AppHandle,
    client: &Client,
    binding: &RepositoryBindingDto,
) -> Result<BTreeMap<String, String>, String> {
    emit_repository_sync_progress(
        app,
        "remote-tree",
        "Fetching the GitHub repository tree...",
        None,
        None,
    );
    let url = format!(
        "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
        binding.owner,
        binding.repo,
        urlencoding::encode(&binding.branch)
    );
    let tree = github_get::<GithubTreeResponse>(client, &url)?;
    let remote_root = binding.remote_path.trim_matches('/');
    let mut files = BTreeMap::new();
    let mut remote_paths = Vec::new();

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
            remote_paths.push(relative_path);
        }
    }

    let remote_total = remote_paths.len();
    for (remote_index, relative_path) in remote_paths.into_iter().enumerate() {
        emit_repository_sync_progress(
            app,
            "remote-content",
            format!("Reading remote file: {relative_path}"),
            Some(remote_index + 1),
            Some(remote_total),
        );
        let content = github_download_file(client, binding, &relative_path)?;
        files.insert(relative_path, content_digest(&content));
    }

    Ok(files)
}

fn github_remote_files_since(
    app: &tauri::AppHandle,
    client: &Client,
    binding: &RepositoryBindingDto,
    base_sha: &str,
    head_sha: &str,
) -> Result<RemoteChangeSet, String> {
    emit_repository_sync_progress(
        app,
        "remote-compare",
        "Asking GitHub which remote files changed...",
        None,
        None,
    );
    let url = format!(
        "https://api.github.com/repos/{}/{}/compare/{}...{}",
        binding.owner,
        binding.repo,
        urlencoding::encode(base_sha),
        urlencoding::encode(head_sha)
    );
    let comparison = github_get::<GithubCompareResponse>(client, &url).map_err(|error| {
        format!("GitHub could not compare the last synced commit with the current branch: {error}")
    })?;

    if comparison.files.len() >= 300 {
        return Err(
            "GitHub returned at least 300 changed files, so the incremental comparison is incomplete. Sync a smaller set of remote commits before trying again. Polarbear did not fall back to a full repository scan."
                .to_owned(),
        );
    }

    let relevant_files = comparison
        .files
        .into_iter()
        .filter(|file| {
            relative_sync_path(binding, &file.filename).is_some()
                || file
                    .previous_filename
                    .as_deref()
                    .and_then(|path| relative_sync_path(binding, path))
                    .is_some()
        })
        .collect::<Vec<_>>();
    let mut changes = RemoteChangeSet::default();
    let total = relevant_files.len();
    for (index, file) in relevant_files.into_iter().enumerate() {
        emit_repository_sync_progress(
            app,
            "remote-diff",
            format!("Processing remote change: {}", file.filename),
            Some(index + 1),
            Some(total),
        );

        if let Some(previous_path) = file.previous_filename.as_deref() {
            if let Some(relative_path) = relative_sync_path(binding, previous_path) {
                changes.deleted_paths.insert(relative_path);
            }
        }

        let Some(relative_path) = relative_sync_path(binding, &file.filename) else {
            continue;
        };
        if file.status == "removed" {
            changes.deleted_paths.insert(relative_path);
            continue;
        }
        changes.changed_paths.insert(relative_path);
    }

    Ok(changes)
}

fn github_delete_file(
    client: &Client,
    binding: &RepositoryBindingDto,
    relative_path: &str,
) -> Result<(), String> {
    if let Some(sha) = github_content_sha(client, binding, relative_path)? {
        let body = GithubDeleteContentRequest {
            message: "Delete notes from Polarbear",
            branch: &binding.branch,
            sha,
        };
        let _: serde_json::Value =
            github_delete(client, &github_content_url(binding, relative_path), &body)?;
    }
    Ok(())
}

fn gitlab_remote_file_paths(
    client: &Client,
    binding: &RepositoryBindingDto,
) -> Result<Vec<String>, String> {
    let mut page = 1;
    let mut paths = Vec::new();
    let remote_root = binding.remote_path.trim_matches('/');

    loop {
        let page_string = page.to_string();
        let url = format!(
            "{}/projects/{}/repository/tree",
            gitlab_api_base(binding.base_url.as_deref()),
            gitlab_project_id(binding)
        );
        let response = client
            .get(&url)
            .query(&[
                ("ref", binding.branch.as_str()),
                ("recursive", "true"),
                ("per_page", "100"),
                ("page", page_string.as_str()),
            ])
            .send()
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?;
        let next_page = response
            .headers()
            .get("x-next-page")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
            .unwrap_or_default();
        let items = response
            .json::<Vec<GitlabTreeItemResponse>>()
            .map_err(|error| error.to_string())?;

        for item in items {
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
                paths.push(relative_path);
            }
        }

        if next_page.is_empty() {
            break;
        }
        page = next_page
            .parse::<i32>()
            .map_err(|error| error.to_string())?;
    }

    Ok(paths)
}

fn gitlab_download_file(
    client: &Client,
    binding: &RepositoryBindingDto,
    relative_path: &str,
) -> Result<Vec<u8>, String> {
    let url = format!(
        "{}/projects/{}/repository/files/{}/raw",
        gitlab_api_base(binding.base_url.as_deref()),
        gitlab_project_id(binding),
        gitlab_file_id(&remote_path_for(binding, relative_path))
    );
    client
        .get(&url)
        .query(&[("ref", binding.branch.as_str())])
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .bytes()
        .map(|bytes| bytes.to_vec())
        .map_err(|error| error.to_string())
}

fn gitlab_remote_files(
    app: &tauri::AppHandle,
    client: &Client,
    binding: &RepositoryBindingDto,
) -> Result<BTreeMap<String, String>, String> {
    let mut files = BTreeMap::new();
    let remote_paths = gitlab_remote_file_paths(client, binding)?;
    let remote_total = remote_paths.len();
    for (remote_index, relative_path) in remote_paths.into_iter().enumerate() {
        emit_repository_sync_progress(
            app,
            "remote-content",
            format!("Reading remote file: {relative_path}"),
            Some(remote_index + 1),
            Some(remote_total),
        );
        let content = gitlab_download_file(client, binding, &relative_path)?;
        files.insert(relative_path, content_digest(&content));
    }
    Ok(files)
}

fn gitlab_remote_files_since(
    app: &tauri::AppHandle,
    client: &Client,
    binding: &RepositoryBindingDto,
    base_sha: &str,
    head_sha: &str,
) -> Result<RemoteChangeSet, String> {
    emit_repository_sync_progress(
        app,
        "remote-compare",
        "Asking GitLab which remote files changed...",
        None,
        None,
    );
    let url = format!(
        "{}/projects/{}/repository/compare",
        gitlab_api_base(binding.base_url.as_deref()),
        gitlab_project_id(binding)
    );
    let comparison = client
        .get(url)
        .query(&[("from", base_sha), ("to", head_sha), ("straight", "true")])
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<GitlabCompareResponse>()
        .map_err(|error| error.to_string())?;

    if comparison.compare_timeout {
        return Err(
            "GitLab timed out while comparing remote commits. Polarbear did not fall back to a full repository scan. Try syncing a smaller set of remote commits."
                .to_owned(),
        );
    }

    let relevant_diffs = comparison
        .diffs
        .into_iter()
        .filter(|diff| {
            relative_sync_path(binding, &diff.old_path).is_some()
                || relative_sync_path(binding, &diff.new_path).is_some()
        })
        .collect::<Vec<_>>();
    let mut changes = RemoteChangeSet::default();
    let total = relevant_diffs.len();
    for (index, diff) in relevant_diffs.into_iter().enumerate() {
        emit_repository_sync_progress(
            app,
            "remote-diff",
            format!("Processing remote change: {}", diff.new_path),
            Some(index + 1),
            Some(total),
        );

        if diff.renamed_file || diff.deleted_file || diff.old_path != diff.new_path {
            if let Some(relative_path) = relative_sync_path(binding, &diff.old_path) {
                changes.deleted_paths.insert(relative_path);
            }
        }
        if diff.deleted_file {
            if let Some(relative_path) = relative_sync_path(binding, &diff.new_path) {
                changes.deleted_paths.insert(relative_path);
            }
            continue;
        }

        let Some(relative_path) = relative_sync_path(binding, &diff.new_path) else {
            continue;
        };
        changes.changed_paths.insert(relative_path);
    }

    Ok(changes)
}

fn provider_remote_files(
    app: &tauri::AppHandle,
    binding: &RepositoryBindingDto,
) -> Result<BTreeMap<String, String>, String> {
    match normalize_repository_provider(&binding.provider)?.as_str() {
        "gitlab" => {
            let token = repository_token(app, "gitlab")?;
            let client = gitlab_client(&token)?;
            gitlab_remote_files(app, &client, binding)
        }
        _ => {
            let token = repository_token(app, "github")?;
            let client = github_client(&token)?;
            github_remote_files(app, &client, binding)
        }
    }
}

fn provider_remote_changes_since(
    app: &tauri::AppHandle,
    binding: &RepositoryBindingDto,
    remote_head: &str,
) -> Result<RemoteChangeSet, String> {
    let Some(base_sha) = binding.last_sync_commit_sha.as_deref() else {
        return Err(
            "Cloud Sync has no baseline commit for an incremental comparison. Open Sync Settings and link the workspace again."
                .to_owned(),
        );
    };
    if base_sha == remote_head {
        return Ok(RemoteChangeSet::default());
    }

    match normalize_repository_provider(&binding.provider)?.as_str() {
        "gitlab" => {
            let token = repository_token(app, "gitlab")?;
            let client = gitlab_client(&token)?;
            gitlab_remote_files_since(app, &client, binding, base_sha, remote_head)
        }
        _ => {
            let token = repository_token(app, "github")?;
            let client = github_client(&token)?;
            github_remote_files_since(app, &client, binding, base_sha, remote_head)
        }
    }
}

fn provider_download_file(
    app: &tauri::AppHandle,
    binding: &RepositoryBindingDto,
    relative_path: &str,
) -> Result<Vec<u8>, String> {
    match normalize_repository_provider(&binding.provider)?.as_str() {
        "gitlab" => {
            let token = repository_token(app, "gitlab")?;
            let client = gitlab_client(&token)?;
            gitlab_download_file(&client, binding, relative_path)
        }
        _ => {
            let token = repository_token(app, "github")?;
            let client = github_client(&token)?;
            github_download_file(&client, binding, relative_path)
        }
    }
}

fn provider_push_workspace_files(
    app: &tauri::AppHandle,
    binding: &RepositoryBindingDto,
    files: &BTreeMap<String, PathBuf>,
    deleted_paths: &[String],
    remote_files_before_push: &BTreeMap<String, String>,
) -> Result<(), String> {
    match normalize_repository_provider(&binding.provider)?.as_str() {
        "gitlab" => {
            let token = repository_token(app, "gitlab")?;
            let client = gitlab_client(&token)?;
            let mut actions = Vec::new();
            let upload_total = files.len() + deleted_paths.len();
            let mut upload_index = 0;

            for (relative_path, path) in files {
                upload_index += 1;
                emit_repository_sync_progress(
                    app,
                    "prepare-upload",
                    format!("Preparing upload: {relative_path}"),
                    Some(upload_index),
                    Some(upload_total),
                );
                let bytes = fs::read(path).map_err(|error| error.to_string())?;
                actions.push(GitlabCommitAction {
                    action: if remote_files_before_push.contains_key(relative_path) {
                        "update".to_owned()
                    } else {
                        "create".to_owned()
                    },
                    file_path: remote_path_for(binding, relative_path),
                    content: Some(BASE64.encode(bytes)),
                    encoding: Some("base64".to_owned()),
                });
            }

            for relative_path in deleted_paths {
                upload_index += 1;
                emit_repository_sync_progress(
                    app,
                    "prepare-upload",
                    format!("Preparing remote deletion: {relative_path}"),
                    Some(upload_index),
                    Some(upload_total),
                );
                actions.push(GitlabCommitAction {
                    action: "delete".to_owned(),
                    file_path: remote_path_for(binding, relative_path),
                    content: None,
                    encoding: None,
                });
            }

            if actions.is_empty() {
                return Ok(());
            }

            let body = GitlabCommitRequest {
                branch: &binding.branch,
                commit_message: "Sync notes from Polarbear",
                actions,
            };
            let url = format!(
                "{}/projects/{}/repository/commits",
                gitlab_api_base(binding.base_url.as_deref()),
                gitlab_project_id(binding)
            );
            emit_repository_sync_progress(
                app,
                "upload",
                format!("Sending {upload_total} change(s) to GitLab..."),
                Some(upload_total),
                Some(upload_total),
            );
            let _: serde_json::Value = client
                .post(url)
                .json(&body)
                .send()
                .map_err(|error| error.to_string())?
                .error_for_status()
                .map_err(|error| error.to_string())?
                .json()
                .map_err(|error| error.to_string())?;
            Ok(())
        }
        _ => {
            let token = repository_token(app, "github")?;
            let client = github_client(&token)?;
            let upload_total = files.len() + deleted_paths.len();
            let mut upload_index = 0;
            for (relative_path, path) in files {
                upload_index += 1;
                emit_repository_sync_progress(
                    app,
                    "upload",
                    format!("Uploading to GitHub: {relative_path}"),
                    Some(upload_index),
                    Some(upload_total),
                );
                let bytes = fs::read(path).map_err(|error| error.to_string())?;
                let content_sha = github_content_sha(&client, binding, relative_path)?;
                let body = GithubPutContentRequest {
                    message: "Update notes from Polarbear",
                    content: BASE64.encode(bytes),
                    branch: &binding.branch,
                    sha: content_sha,
                };
                let _: serde_json::Value =
                    github_put(&client, &github_content_url(binding, relative_path), &body)?;
            }

            for relative_path in deleted_paths {
                upload_index += 1;
                emit_repository_sync_progress(
                    app,
                    "upload",
                    format!("Deleting from GitHub: {relative_path}"),
                    Some(upload_index),
                    Some(upload_total),
                );
                github_delete_file(&client, binding, relative_path)?;
            }
            Ok(())
        }
    }
}

fn main() -> tauri::Result<()> {
    tauri::Builder::default()
        .manage(app_zoom::AppZoomState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            native_pinch::install_native_pinch(app).map_err(std::io::Error::other)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("polarbear-window-close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
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
            repository_connect_provider,
            repository_disconnect_provider,
            repository_get_account,
            repository_list_repositories,
            repository_link_workspace,
            repository_get_workspace_binding,
            repository_get_sync_status,
            repository_push_workspace,
            repository_pull_workspace,
            repository_sync_now
        ])
        .run(tauri::generate_context!())
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::{
        create_markdown_file, create_workspace_directory, get_markdown_file_revision,
        list_workspace_files, load_markdown_file, rename_entry, save_markdown_file_content,
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
        assert!(source.markdown_content.contains("Start writing in Polarbear"));
    }

    #[test]
    fn save_rejects_an_externally_changed_document_without_overwriting_it() {
        let root = test_workspace_root("save-rejects-external-change");
        create_markdown_file(root.clone(), "note.md".to_owned())
            .expect("create markdown file");
        let loaded = load_markdown_file(root.clone(), "note.md".to_owned())
            .expect("load markdown file");

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
        create_markdown_file(root.clone(), "note.md".to_owned())
            .expect("create markdown file");
        let loaded = load_markdown_file(root.clone(), "note.md".to_owned())
            .expect("load markdown file");
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
        create_markdown_file(root.clone(), "note.md".to_owned())
            .expect("create markdown file");

        let revision = get_markdown_file_revision(root, "note.md".to_owned())
            .expect("existing files should be represented in the revision response");

        assert!(revision.exists);
        assert!(revision.watch_token.is_some());
    }
}
