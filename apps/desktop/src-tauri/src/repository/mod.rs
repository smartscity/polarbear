mod conditional_publish;
pub(crate) mod model;
pub(crate) mod policy;
mod progress;
mod provider;
mod response_limits;
pub(crate) mod store;
mod sync_coordinator;
mod sync_plan;

use crate::repository_identity::{
    normalize_repository_provider, read_account, read_connected_account, repository_provider_label,
    repository_token, RepositoryAccountDto,
};
use crate::{cloud_sync_store, repository_identity, workspace_paths::workspace_path};
use model::{
    ConnectRepositoryProviderRequest, LinkWorkspaceRequest, RepositoryBindingDto,
    RepositoryInfoDto, RepositorySyncStatusDto, WorkspaceSyncRequest,
};
use policy::{manifest_change_count, remote_manifest_changed};
use progress::emit_repository_sync_progress;
use provider::{
    github_client, github_get, github_repositories, gitlab_api_base, gitlab_client, gitlab_get,
    gitlab_repositories, normalize_gitlab_base_url, provider_branch_head_sha,
    provider_download_file, provider_remote_files, GithubUserResponse, GitlabUserResponse,
};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use store::{
    cloud_sync_database_path, local_manifest, read_binding, read_bindings, update_sync_outbox,
    write_bindings,
};

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

async fn run_repository_task<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || with_repository_operation(task))
        .await
        .map_err(|error| format!("Cloud Sync background task failed: {error}"))?
}

fn with_repository_operation<T>(task: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    // The store has one active run and whole-binding transactions. Admission must
    // match those scopes until persistence and progress become independently scoped.
    static OPERATIONS: Mutex<()> = Mutex::new(());
    let _lease = OPERATIONS
        .try_lock()
        .map_err(|_| "Cloud Sync is busy; wait for the current operation.".to_owned())?;
    task()
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
    repository_identity::ensure_available(&app)?;
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
        RepositoryAccountDto {
            provider,
            account_id: user.id.to_string(),
            login: user.login,
            avatar_url: user.avatar_url,
            base_url: None,
            connected_at: now_unix_seconds(),
        }
    };

    repository_identity::save_account(&app, &account, token)?;
    Ok(account)
}

#[tauri::command]
pub(crate) async fn repository_connect_provider(
    app: tauri::AppHandle,
    request: ConnectRepositoryProviderRequest,
) -> Result<RepositoryAccountDto, String> {
    run_repository_task(move || repository_connect_provider_blocking(app, request)).await
}

#[tauri::command]
pub(crate) async fn repository_disconnect_provider(app: tauri::AppHandle) -> Result<(), String> {
    run_repository_task(move || repository_identity::disconnect(&app)).await
}

#[tauri::command]
pub(crate) async fn repository_get_account(
    app: tauri::AppHandle,
) -> Result<Option<RepositoryAccountDto>, String> {
    run_repository_task(move || read_connected_account(&app)).await
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
pub(crate) async fn repository_list_repositories(
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
    let mut frozen = binding.clone();
    frozen.branch = head_sha.clone();
    let remote_manifest = provider_remote_files(&app, &frozen)?;
    binding.last_sync_commit_sha = Some(head_sha);
    binding.last_sync_at = None;
    binding.manifest = remote_manifest;

    let mut bindings = read_bindings(&app)?;
    bindings.insert(binding.workspace_ref.clone(), binding.clone());
    write_bindings(&app, &bindings)?;
    Ok(binding)
}

#[tauri::command]
pub(crate) async fn repository_link_workspace(
    app: tauri::AppHandle,
    request: LinkWorkspaceRequest,
) -> Result<RepositoryBindingDto, String> {
    run_repository_task(move || repository_link_workspace_blocking(app, request)).await
}

#[tauri::command]
pub(crate) fn repository_get_workspace_binding(
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
pub(crate) async fn repository_get_sync_status(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
) -> Result<RepositorySyncStatusDto, String> {
    run_repository_task(move || repository_get_sync_status_blocking(app, request)).await
}

fn repository_push_workspace_blocking(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
    _remote_already_checked: bool,
) -> Result<RepositorySyncStatusDto, String> {
    synchronize_workspace(app, request, true, false)
}

#[tauri::command]
pub(crate) async fn repository_push_workspace(
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
    _known_remote_head: Option<String>,
) -> Result<RepositorySyncStatusDto, String> {
    synchronize_workspace(app, request, false, force_remote)
}

#[tauri::command]
pub(crate) async fn repository_pull_workspace(
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
    synchronize_workspace(app, request, true, false)
}

#[tauri::command]
pub(crate) async fn repository_sync_now(
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

#[cfg(test)]
mod characterization_tests;
#[cfg(test)]
mod conditional_publish_tests;
#[cfg(test)]
mod live_acceptance;
#[cfg(test)]
mod provider_response_tests;
#[cfg(test)]
mod sync_tests;

fn synchronize_workspace(
    app: tauri::AppHandle,
    request: WorkspaceSyncRequest,
    upload: bool,
    discard_local: bool,
) -> Result<RepositorySyncStatusDto, String> {
    if request.dirty {
        return Err("Save current document before syncing.".into());
    }
    let binding =
        read_binding(&app, &request.workspace_ref)?.ok_or("Link this workspace before syncing.")?;
    let baseline = if binding.has_synced {
        binding.manifest.clone()
    } else {
        BTreeMap::new()
    };
    emit_repository_sync_progress(
        &app,
        "scan-local",
        "Scanning local workspace...",
        None,
        None,
    );
    let local = local_manifest(&app, &binding.workspace_ref)?;
    update_sync_outbox(&app, &binding, &local)?;
    let head = provider_branch_head_sha(&app, &binding)?;
    let mut frozen = binding.clone();
    frozen.branch = head.clone();
    let remote = provider_remote_files(&app, &frozen)?;
    let mut io = NativeSync {
        app: &app,
        binding,
        remote: &remote,
    };
    let outcome = sync_coordinator::synchronize(
        &mut io,
        &baseline,
        &local,
        &remote,
        &head,
        upload,
        discard_local,
    )?;
    let current = local_manifest(&app, &io.binding.workspace_ref)?;
    update_sync_outbox(&app, &io.binding, &current)?;
    Ok(RepositorySyncStatusDto {
        account: read_connected_account(&app)?,
        local_changes: manifest_change_count(&current, &io.binding.manifest),
        binding: Some(io.binding),
        remote_changed: outcome.remote_pending,
        conflicts: outcome.conflicts,
    })
}

struct NativeSync<'a> {
    app: &'a tauri::AppHandle,
    binding: RepositoryBindingDto,
    remote: &'a sync_plan::Manifest,
}

impl sync_coordinator::SyncIo for NativeSync<'_> {
    fn read_local(&mut self, path: &str, limit: usize) -> Result<Vec<u8>, String> {
        let _access = crate::workspace_io::document_access().map_err(|error| error.to_string())?;
        let mut bytes = Vec::new();
        fs::File::open(workspace_path(&self.binding.workspace_ref, path)?)
            .and_then(|file| file.take(limit as u64 + 1).read_to_end(&mut bytes))
            .map_err(|error| error.to_string())?;
        Ok(bytes)
    }
    fn read_remote(&mut self, commit: &str, path: &str) -> Result<Vec<u8>, String> {
        let mut frozen = self.binding.clone();
        frozen.branch = commit.into();
        provider_download_file(self.app, &frozen, path)
    }
    fn apply_local(
        &mut self,
        path: &str,
        expected: Option<&str>,
        content: Option<&[u8]>,
    ) -> Result<(), String> {
        crate::document_save::apply_sync_change(
            &self.binding.workspace_ref,
            path,
            expected,
            content,
        )
    }
    fn publish(
        &mut self,
        commit: &str,
        changes: &BTreeMap<String, Option<Vec<u8>>>,
    ) -> Result<sync_coordinator::PublishedCommit, String> {
        conditional_publish::publish(self.app, &self.binding, commit, self.remote, changes)
    }
    fn checkpoint(
        &mut self,
        baseline: &sync_plan::Manifest,
        commit: &str,
        complete: bool,
    ) -> Result<(), String> {
        let mut next = self.binding.clone();
        next.manifest = baseline.clone();
        // A partial download must not advertise that the whole remote head is synchronized.
        next.last_sync_commit_sha = complete.then(|| commit.into());
        if complete {
            next.last_sync_at = Some(now_unix_seconds());
        }
        next.has_synced = true;
        let mut bindings = read_bindings(self.app)?;
        bindings.insert(next.workspace_ref.clone(), next.clone());
        write_bindings(self.app, &bindings)?;
        self.binding = next;
        Ok(())
    }
}
