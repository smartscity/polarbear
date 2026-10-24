use crate::repository_identity::RepositoryAccountDto;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectRepositoryProviderRequest {
    pub(crate) provider: String,
    pub(crate) token: String,
    pub(crate) base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkWorkspaceRequest {
    pub(crate) workspace_ref: String,
    pub(crate) provider: Option<String>,
    pub(crate) owner: String,
    pub(crate) repo: String,
    pub(crate) branch: String,
    pub(crate) remote_path: String,
    pub(crate) base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSyncRequest {
    pub(crate) workspace_ref: String,
    pub(crate) dirty: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryInfoDto {
    pub(crate) provider: String,
    pub(crate) owner: String,
    pub(crate) name: String,
    pub(crate) full_name: String,
    pub(crate) default_branch: String,
    pub(crate) private: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryBindingDto {
    pub(crate) workspace_ref: String,
    pub(crate) provider: String,
    pub(crate) owner: String,
    pub(crate) repo: String,
    pub(crate) branch: String,
    pub(crate) remote_path: String,
    pub(crate) base_url: Option<String>,
    pub(crate) last_sync_commit_sha: Option<String>,
    pub(crate) last_sync_at: Option<i64>,
    #[serde(default)]
    pub(crate) has_synced: bool,
    pub(crate) manifest: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositorySyncStatusDto {
    pub(crate) account: Option<RepositoryAccountDto>,
    pub(crate) binding: Option<RepositoryBindingDto>,
    pub(crate) local_changes: usize,
    pub(crate) remote_changed: bool,
    pub(crate) conflicts: Vec<String>,
}

#[derive(Default)]
pub(crate) struct RemoteChangeSet {
    pub(crate) changed_paths: BTreeSet<String>,
    pub(crate) deleted_paths: BTreeSet<String>,
}
