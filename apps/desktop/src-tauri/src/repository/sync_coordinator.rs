use super::{
    policy::content_digest,
    sync_plan::{plan, Action, Manifest},
};
use std::collections::BTreeMap;

pub(super) trait SyncIo {
    fn read_local(&mut self, path: &str) -> Result<Vec<u8>, String>;
    fn read_remote(&mut self, commit: &str, path: &str) -> Result<Vec<u8>, String>;
    fn apply_local(
        &mut self,
        path: &str,
        expected: Option<&str>,
        content: Option<&[u8]>,
    ) -> Result<(), String>;
    fn publish(
        &mut self,
        commit: &str,
        changes: &BTreeMap<String, Option<Vec<u8>>>,
    ) -> Result<String, String>;
    fn checkpoint(&mut self, baseline: &Manifest, commit: &str) -> Result<(), String>;
}

pub(super) struct SyncOutcome {
    pub conflicts: Vec<String>,
}

/// Checkpoints only acknowledged content. A failed checkpoint is retried by three-way comparison.
pub(super) fn synchronize(
    io: &mut impl SyncIo,
    baseline: &Manifest,
    local: &Manifest,
    remote: &Manifest,
    remote_commit: &str,
    upload: bool,
    discard_local: bool,
) -> Result<SyncOutcome, String> {
    let mut actions = plan(baseline, local, remote);
    if discard_local {
        for (path, action) in &mut actions {
            *action = if local.get(path) == remote.get(path) {
                Action::Converged
            } else {
                Action::Download
            };
        }
    }
    let conflicts = actions
        .iter()
        .filter(|(_, action)| **action == Action::Conflict)
        .map(|(path, _)| path.clone())
        .collect::<Vec<_>>();
    if !conflicts.is_empty() {
        return Ok(SyncOutcome { conflicts });
    }

    let mut acknowledged = baseline.clone();
    let mut uploads = BTreeMap::new();
    for (path, action) in actions {
        match action {
            Action::Converged => set_digest(&mut acknowledged, &path, remote.get(&path)),
            Action::Download => {
                let content = if let Some(expected) = remote.get(&path) {
                    let bytes = io.read_remote(remote_commit, &path)?;
                    if content_digest(&bytes) != *expected {
                        return Err("Remote snapshot content mismatch; sync stopped.".into());
                    }
                    Some(bytes)
                } else {
                    None
                };
                io.apply_local(
                    &path,
                    local.get(&path).map(String::as_str),
                    content.as_deref(),
                )?;
                set_digest(&mut acknowledged, &path, remote.get(&path));
                io.checkpoint(&acknowledged, remote_commit)?;
            }
            Action::Upload if upload => {
                let content = if let Some(expected) = local.get(&path) {
                    let bytes = io.read_local(&path)?;
                    if content_digest(&bytes) != *expected {
                        return Err("Local file changed during sync; retry after saving.".into());
                    }
                    Some(bytes)
                } else {
                    None
                };
                uploads.insert(path, content);
            }
            Action::Upload | Action::Conflict => {}
        }
    }
    let committed = if uploads.is_empty() {
        remote_commit.to_owned()
    } else {
        let commit = io.publish(remote_commit, &uploads)?;
        for (path, bytes) in &uploads {
            let digest = bytes.as_deref().map(content_digest);
            set_digest(&mut acknowledged, path, digest.as_ref());
        }
        commit
    };
    io.checkpoint(&acknowledged, &committed)?;
    Ok(SyncOutcome {
        conflicts: Vec::new(),
    })
}

fn set_digest(manifest: &mut Manifest, path: &str, value: Option<&String>) {
    if let Some(value) = value {
        manifest.insert(path.into(), value.clone());
    } else {
        manifest.remove(path);
    }
}
