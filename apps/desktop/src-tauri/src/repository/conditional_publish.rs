use super::{
    model::RepositoryBindingDto,
    policy::remote_path_for,
    provider::{github_client, gitlab_api_base, gitlab_client, gitlab_file_id, gitlab_project_id},
    sync_plan::Manifest,
};
use crate::repository_identity::repository_token;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::collections::BTreeMap;

type Changes = BTreeMap<String, Option<Vec<u8>>>;

pub(super) fn publish(
    app: &tauri::AppHandle,
    binding: &RepositoryBindingDto,
    expected: &str,
    remote: &Manifest,
    changes: &Changes,
) -> Result<String, String> {
    if binding.provider == "gitlab" {
        let client = gitlab_client(&repository_token(app, "gitlab")?)?;
        gitlab_publish(
            &client,
            &format!(
                "{}/projects/{}",
                gitlab_api_base(binding.base_url.as_deref()),
                gitlab_project_id(binding)
            ),
            binding,
            expected,
            remote,
            changes,
        )
    } else {
        let client = github_client(&repository_token(app, "github")?)?;
        github_publish(
            &client,
            "https://api.github.com/graphql",
            binding,
            expected,
            changes,
        )
    }
}

fn commit_response(
    response: Result<reqwest::blocking::Response, reqwest::Error>,
    github: bool,
) -> Result<Value, String> {
    let response = response.map_err(|_| "Sync publication outcome is unknown. Retry Sync to reconcile the remote snapshot; no baseline was advanced.".to_owned())?;
    if !response.status().is_success() {
        if github {
            return Err(super::provider::github_api_error(
                response,
                "publish a conditional commit",
            ));
        }
        return Err(format!("Conditional sync publication rejected ({}). Remote changes were not overwritten; retry Sync to compare versions.", response.status()));
    }
    response.json().map_err(|_| "Sync publication outcome is unknown: acknowledgment could not be decoded. Retry Sync to reconcile.".to_owned())
}

pub(super) fn github_publish(
    client: &Client,
    endpoint: &str,
    binding: &RepositoryBindingDto,
    expected: &str,
    changes: &Changes,
) -> Result<String, String> {
    let additions = changes.iter().filter_map(|(path, bytes)| bytes.as_ref().map(|bytes| json!({"path": remote_path_for(binding, path), "contents": BASE64.encode(bytes)}))).collect::<Vec<_>>();
    let deletions = changes
        .iter()
        .filter(|(_, bytes)| bytes.is_none())
        .map(|(path, _)| json!({"path": remote_path_for(binding, path)}))
        .collect::<Vec<_>>();
    let response = commit_response(client.post(endpoint).json(&json!({
        "query": "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",
        "variables": {"input": {
            "branch": {"repositoryNameWithOwner": format!("{}/{}", binding.owner, binding.repo), "refName": binding.branch},
            "expectedHeadOid": expected, "message": {"headline": "Sync notes from Polarbear"},
            "fileChanges": {"additions": additions, "deletions": deletions}
        }}
    })).send(), true)?;
    if response
        .get("errors")
        .is_some_and(|errors| errors.as_array().is_none_or(|errors| !errors.is_empty()))
    {
        return Err("Conditional GitHub commit rejected. Retry Sync to compare remote changes; no baseline was advanced.".into());
    }
    response
        .pointer("/data/createCommitOnBranch/commit/oid")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "Sync publication outcome is unknown: missing commit acknowledgment.".into())
}

pub(super) fn gitlab_publish(
    client: &Client,
    project_endpoint: &str,
    binding: &RepositoryBindingDto,
    expected: &str,
    remote: &Manifest,
    changes: &Changes,
) -> Result<String, String> {
    let mut actions = Vec::new();
    for (path, bytes) in changes {
        let remote_path = remote_path_for(binding, path);
        let mut action = json!({"action": if bytes.is_none() {"delete"} else if remote.contains_key(path) {"update"} else {"create"}, "file_path": remote_path});
        if remote.contains_key(path) {
            let metadata: Value = client
                .get(format!(
                    "{project_endpoint}/repository/files/{}",
                    gitlab_file_id(&remote_path)
                ))
                .query(&[("ref", expected)])
                .send()
                .map_err(|error| error.to_string())?
                .error_for_status()
                .map_err(|error| error.to_string())?
                .json()
                .map_err(|error| error.to_string())?;
            let last = metadata
                .get("last_commit_id")
                .and_then(Value::as_str)
                .ok_or("GitLab did not return a conditional file version; publication stopped.")?;
            action["last_commit_id"] = json!(last);
        }
        if let Some(bytes) = bytes {
            action["content"] = json!(BASE64.encode(bytes));
            action["encoding"] = json!("base64");
        }
        actions.push(action);
    }
    // GitLab guards each affected file, not the whole branch tip. Unrelated remote changes survive.
    let response = commit_response(client.post(format!("{project_endpoint}/repository/commits")).json(&json!({
        "branch": binding.branch, "commit_message": "Sync notes from Polarbear", "actions": actions,
    })).send(), false)?;
    response
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "Sync publication outcome is unknown: missing commit acknowledgment.".into())
}
