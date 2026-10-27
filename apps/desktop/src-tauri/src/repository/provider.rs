use super::{
    model::{RepositoryBindingDto, RepositoryInfoDto},
    policy::{content_digest, github_content_url, relative_sync_path, remote_path_for},
    progress::emit_repository_sync_progress,
    response_limits::{self, EnumerationBudget},
};
use crate::repository_identity::{normalize_repository_provider, repository_token};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::{collections::BTreeMap, time::Duration};

#[derive(Debug, Deserialize)]
pub(super) struct GithubUserResponse {
    pub(super) id: u64,
    pub(super) login: String,
    pub(super) avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GithubRepoOwnerResponse {
    pub(super) login: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GithubRepoResponse {
    pub(super) name: String,
    pub(super) full_name: String,
    pub(super) default_branch: String,
    pub(super) private: bool,
    pub(super) owner: GithubRepoOwnerResponse,
}

#[derive(Debug, Deserialize)]
pub(super) struct GithubBranchResponse {
    pub(super) commit: GithubCommitRef,
}

#[derive(Debug, Deserialize)]
pub(super) struct GithubCommitRef {
    pub(super) sha: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GithubTreeResponse {
    pub(super) tree: Vec<GithubTreeItemResponse>,
    #[serde(default)]
    pub(super) truncated: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct GithubTreeItemResponse {
    pub(super) path: String,
    #[serde(rename = "type")]
    pub(super) item_type: String,
    pub(super) size: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitlabUserResponse {
    pub(super) id: u64,
    pub(super) username: String,
    pub(super) avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitlabProjectResponse {
    pub(super) path: String,
    pub(super) path_with_namespace: String,
    pub(super) default_branch: Option<String>,
    pub(super) visibility: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitlabBranchResponse {
    pub(super) commit: GitlabCommitRef,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitlabCommitRef {
    pub(super) id: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitlabTreeItemResponse {
    pub(super) path: String,
    #[serde(rename = "type")]
    pub(super) item_type: String,
}

pub(super) fn github_client(token: &str) -> Result<Client, String> {
    Client::builder()
        .user_agent("Polarbear")
        .redirect(reqwest::redirect::Policy::none())
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

pub(super) fn normalize_gitlab_base_url(base_url: Option<&str>) -> String {
    let trimmed = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("https://gitlab.com");
    trimmed.trim_end_matches('/').to_owned()
}

pub(super) fn github_get<T: for<'de> Deserialize<'de>>(
    client: &Client,
    url: &str,
) -> Result<T, String> {
    let response = client
        .get(url)
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    response_limits::json(response, response_limits::JSON_BYTES)
}

pub(super) fn github_api_error(response: reqwest::blocking::Response, operation: &str) -> String {
    let status = response.status();
    let request_id = response
        .headers()
        .get("x-github-request-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let github_message =
        match response_limits::json::<serde_json::Value>(response, response_limits::ERROR_BYTES) {
            Ok(json) => json
                .get("message")
                .and_then(|value| value.as_str())
                .filter(|message| !message.trim().is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| status.to_string()),
            Err(error) => format!("{status}; {error}"),
        };
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

pub(super) fn gitlab_client(token: &str) -> Result<Client, String> {
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

pub(super) fn gitlab_api_base(base_url: Option<&str>) -> String {
    format!("{}/api/v4", normalize_gitlab_base_url(base_url))
}

pub(super) fn gitlab_project_path(owner: &str, repo: &str) -> String {
    if owner.trim().is_empty() {
        repo.to_owned()
    } else {
        format!("{owner}/{repo}")
    }
}

pub(super) fn gitlab_project_id(binding: &RepositoryBindingDto) -> String {
    urlencoding::encode(&gitlab_project_path(&binding.owner, &binding.repo)).to_string()
}

pub(super) fn gitlab_file_id(path: &str) -> String {
    urlencoding::encode(path).to_string()
}

pub(super) fn gitlab_get<T: for<'de> Deserialize<'de>>(
    client: &Client,
    url: &str,
) -> Result<T, String> {
    github_get(client, url)
}

pub(super) fn branch_head_sha(
    client: &Client,
    binding: &RepositoryBindingDto,
) -> Result<String, String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/branches/{}",
        binding.owner,
        binding.repo,
        urlencoding::encode(&binding.branch)
    );
    Ok(github_get::<GithubBranchResponse>(client, &url)?.commit.sha)
}

pub(super) fn gitlab_branch_head_sha(
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

pub(super) fn provider_branch_head_sha(
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

pub(super) fn github_repositories(client: &Client) -> Result<Vec<RepositoryInfoDto>, String> {
    let mut page = 1;
    let mut repositories = Vec::new();
    let mut budget = EnumerationBudget::default();

    loop {
        let response = client
            .get(format!(
                "https://api.github.com/user/repos?per_page=100&sort=updated&page={page}"
            ))
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| error.to_string())?;
        let repos: Vec<GithubRepoResponse> = budget.read_page(response)?;
        let repo_count = repos.len();
        budget.admit_entries(repo_count)?;
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

pub(super) fn gitlab_repositories(
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
    EnumerationBudget::default().admit_entries(projects.len())?;

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

pub(super) fn github_download_file(
    client: &Client,
    binding: &RepositoryBindingDto,
    relative_path: &str,
) -> Result<Vec<u8>, String> {
    github_download_content(
        client,
        &github_content_url(binding, relative_path),
        &binding.branch,
    )
}

// The production caller constructs the trusted URL; tests substitute a loopback endpoint.
pub(super) fn github_download_content(
    client: &Client,
    url: &str,
    commit: &str,
) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github.raw+json")
        .query(&[("ref", commit)])
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "GitHub download rejected ({}); no content was accepted.",
            response.status()
        ));
    }
    response_limits::bytes(response, response_limits::FILE_BYTES)
}

pub(super) fn github_remote_files(
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
    EnumerationBudget::default().admit_entries(tree.tree.len())?;
    if tree.truncated {
        return Err(
            "GitHub returned an incomplete tree; sync stopped without deleting files.".into(),
        );
    }
    let mut files = BTreeMap::new();
    let mut remote_paths = Vec::new();

    for item in tree.tree {
        if item.item_type != "blob" {
            continue;
        }

        if let Some(relative_path) = relative_sync_path(binding, &item.path) {
            let size = item
                .size
                .ok_or("GitHub tree omitted a blob size; sync stopped.")?;
            if size > response_limits::FILE_BYTES as u64 {
                return Err("GitHub file exceeds the 64 MiB size limit; sync stopped.".into());
            }
            remote_paths.push((relative_path, size));
        }
    }

    let remote_total = remote_paths.len();
    for (remote_index, (relative_path, expected_size)) in remote_paths.into_iter().enumerate() {
        emit_repository_sync_progress(
            app,
            "remote-content",
            format!("Reading remote file: {relative_path}"),
            Some(remote_index + 1),
            Some(remote_total),
        );
        let content = github_download_file(client, binding, &relative_path)?;
        if content.len() as u64 != expected_size {
            return Err("GitHub content length differs from the frozen tree; sync stopped.".into());
        }
        files.insert(relative_path, content_digest(&content));
    }

    Ok(files)
}

pub(super) fn gitlab_remote_file_paths(
    client: &Client,
    binding: &RepositoryBindingDto,
) -> Result<Vec<String>, String> {
    let mut page = 1;
    let mut paths = Vec::new();
    let mut budget = EnumerationBudget::default();

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
        let items: Vec<GitlabTreeItemResponse> = budget.read_page(response)?;
        budget.admit_entries(items.len())?;

        for item in items {
            if item.item_type != "blob" {
                continue;
            }
            if let Some(relative_path) = relative_sync_path(binding, &item.path) {
                paths.push(relative_path);
            }
        }

        let Some(next) = response_limits::next_page(page, &next_page)? else {
            break;
        };
        page = next;
    }

    Ok(paths)
}

pub(super) fn gitlab_download_file(
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
    let response = client
        .get(&url)
        .query(&[("ref", binding.branch.as_str())])
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    response_limits::bytes(response, response_limits::FILE_BYTES)
}

pub(super) fn gitlab_remote_files(
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

pub(super) fn provider_remote_files(
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

pub(super) fn provider_download_file(
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
