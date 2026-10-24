pub(crate) mod model;
pub(crate) mod policy;
mod progress;
mod provider;
pub(crate) mod store;

use crate::repository_identity::{
    normalize_repository_provider, read_account, read_connected_account, repository_provider_label,
    repository_token, RepositoryAccountDto,
};
use crate::{
    cloud_sync_store, document_save::atomic_write, repository_identity,
    workspace_paths::workspace_path,
};
use model::{
    ConnectRepositoryProviderRequest, LinkWorkspaceRequest, RepositoryBindingDto,
    RepositoryInfoDto, RepositorySyncStatusDto, WorkspaceSyncRequest,
};
use policy::{content_digest, manifest_change_count, remote_manifest_changed};
use progress::emit_repository_sync_progress;
use provider::{
    github_client, github_get, github_repositories, gitlab_api_base, gitlab_client, gitlab_get,
    gitlab_repositories, normalize_gitlab_base_url, provider_branch_head_sha,
    provider_download_file, provider_push_workspace_files, provider_remote_changes_since,
    provider_remote_files, GithubUserResponse, GitlabUserResponse,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    time::{SystemTime, UNIX_EPOCH},
};
use store::{
    cloud_sync_database_path, local_manifest, local_snapshot, read_binding, read_bindings,
    update_sync_outbox, write_bindings,
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
