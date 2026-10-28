#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Opt-in real-service acceptance. Requires a pre-created owned branch and generated workspace.
use super::{
    conditional_publish,
    model::RepositoryBindingDto,
    policy::{content_digest, relative_sync_path},
    provider, store,
    sync_coordinator::{synchronize, PublishedCommit, SyncIo},
    sync_plan::Manifest,
};
use reqwest::blocking::Client;
use serde_json::json;
use std::{collections::BTreeMap, fs, path::PathBuf};

struct LiveProvider {
    binding: RepositoryBindingDto,
    client: Client,
    baseline: Manifest,
    observed: Manifest,
    checkpoints: Vec<bool>,
}
impl LiveProvider {
    fn head(&self) -> Result<String, String> {
        if self.binding.provider == "gitlab" {
            provider::gitlab_branch_head_sha(&self.client, &self.binding)
        } else {
            provider::branch_head_sha(&self.client, &self.binding)
        }
    }
    fn frozen(&self, commit: &str) -> RepositoryBindingDto {
        let mut b = self.binding.clone();
        b.branch = commit.into();
        b
    }
    fn observe(&mut self, commit: &str) -> Result<Manifest, String> {
        let frozen = self.frozen(commit);
        let paths = if frozen.provider == "gitlab" {
            provider::gitlab_remote_file_paths(&self.client, &frozen)?
        } else {
            let tree: provider::GithubTreeResponse = provider::github_get(
                &self.client,
                &format!(
                    "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
                    frozen.owner, frozen.repo, commit
                ),
            )?;
            if tree.truncated {
                return Err("Incomplete tree".into());
            }
            tree.tree
                .iter()
                .filter(|item| item.item_type == "blob")
                .filter_map(|item| relative_sync_path(&frozen, &item.path))
                .collect()
        };
        let mut manifest = Manifest::new();
        for path in paths {
            manifest.insert(
                path.clone(),
                content_digest(&self.read_remote(commit, &path)?),
            );
        }
        Ok(manifest)
    }
    fn local(&self) -> Manifest {
        let root = PathBuf::from(&self.binding.workspace_ref);
        store::scan_sync_files(&root, &root)
            .unwrap()
            .into_iter()
            .map(|(p, f)| (p, store::file_digest(&f).unwrap()))
            .collect()
    }
    fn run(
        &mut self,
        commit: &str,
        remote: &Manifest,
    ) -> Result<super::sync_coordinator::SyncOutcome, String> {
        self.observed = remote.clone();
        synchronize(
            self,
            &self.baseline.clone(),
            &self.local(),
            remote,
            commit,
            true,
            false,
        )
    }
}
impl SyncIo for LiveProvider {
    fn read_local(&mut self, path: &str, limit: usize) -> Result<Vec<u8>, String> {
        use std::io::Read;
        let mut bytes = Vec::new();
        fs::File::open(PathBuf::from(&self.binding.workspace_ref).join(path))
            .and_then(|file| file.take(limit as u64 + 1).read_to_end(&mut bytes))
            .map_err(|e| e.to_string())?;
        Ok(bytes)
    }
    fn read_remote(&mut self, commit: &str, path: &str) -> Result<Vec<u8>, String> {
        let frozen = self.frozen(commit);
        if frozen.provider == "gitlab" {
            provider::gitlab_download_file(&self.client, &frozen, path)
        } else {
            provider::github_download_file(&self.client, &frozen, path)
        }
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
    ) -> Result<PublishedCommit, String> {
        if self.binding.provider == "gitlab" {
            conditional_publish::gitlab_publish(
                &self.client,
                &format!(
                    "{}/projects/{}",
                    provider::gitlab_api_base(self.binding.base_url.as_deref()),
                    provider::gitlab_project_id(&self.binding)
                ),
                &self.binding,
                commit,
                &self.observed,
                changes,
            )
            .map(PublishedCommit::ChangedPaths)
        } else {
            conditional_publish::github_publish(
                &self.client,
                "https://api.github.com/graphql",
                &self.binding,
                commit,
                changes,
            )
            .map(PublishedCommit::FullSnapshot)
        }
    }
    fn checkpoint(&mut self, baseline: &Manifest, _: &str, complete: bool) -> Result<(), String> {
        self.baseline = baseline.clone();
        self.checkpoints.push(complete);
        Ok(())
    }
}

#[test]
#[ignore = "Requires POLARBEAR_LIVE_ACCEPTANCE_CONFIG, owned private sandbox branch and the existing application Keychain credential"]
fn isolated_provider_acceptance() {
    let config = PathBuf::from(
        std::env::var("POLARBEAR_LIVE_ACCEPTANCE_CONFIG")
            .expect("An explicit isolated config is required"),
    );
    let binding: RepositoryBindingDto =
        serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
    let root = fs::canonicalize(&binding.workspace_ref).unwrap();
    let parent = root.parent().unwrap();
    let ownership: serde_json::Value =
        serde_json::from_slice(&fs::read(parent.join("ownership.json")).unwrap()).unwrap();
    let run_id = ownership["runId"].as_str().unwrap();
    assert!(run_id.starts_with("polarbear-acceptance-"));
    assert_eq!(binding.branch, run_id);
    assert_eq!(binding.remote_path, run_id);
    assert_eq!(
        root,
        fs::canonicalize(ownership["workspace"].as_str().unwrap()).unwrap()
    );
    assert!(matches!(binding.provider.as_str(), "github" | "gitlab"));
    let token = crate::secret_store::acceptance_repository_secret(&binding.provider)
        .expect("Existing application credential unavailable; connect through Polarbear first");
    let client = if binding.provider == "gitlab" {
        provider::gitlab_client(&token)
    } else {
        provider::github_client(&token)
    }
    .unwrap();
    drop(token);
    let mut io = LiveProvider {
        binding,
        client,
        baseline: Manifest::new(),
        observed: Manifest::new(),
        checkpoints: vec![],
    };
    if io.binding.provider == "github" {
        assert_eq!(io.binding.owner, "smartscity");
        assert!(io.binding.repo.starts_with("polarbear-sync-sandbox"));
        let metadata: serde_json::Value = provider::github_get(
            &io.client,
            &format!(
                "https://api.github.com/repos/{}/{}",
                io.binding.owner, io.binding.repo
            ),
        )
        .unwrap();
        assert_eq!(
            metadata["private"], true,
            "Only a private sandbox is authorized"
        );
    } else {
        let metadata: serde_json::Value = provider::gitlab_get(
            &io.client,
            &format!(
                "{}/projects/{}",
                provider::gitlab_api_base(io.binding.base_url.as_deref()),
                provider::gitlab_project_id(&io.binding)
            ),
        )
        .unwrap();
        assert_eq!(
            metadata["visibility"], "private",
            "Use an explicitly authorized private project"
        );
    }
    let start = io
        .head()
        .expect("Application credential cannot read the authorized target branch");
    assert!(
        io.observe(&start).unwrap().is_empty(),
        "Run path must be new; existing remote data will not be overwritten"
    );
    let local = io.local();
    assert_eq!(local.len(), 4, "Use only the generated four-file workspace");
    for (path, digest) in &local {
        assert_eq!(
            digest.strip_prefix("sha256:v1:").unwrap(),
            ownership["files"][path]["sha256"].as_str().unwrap(),
            "Generated fixture differs: {path}"
        );
    }
    assert_eq!(fs::read(root.join("a.md")).unwrap(), b"# a0\n");
    assert_eq!(fs::read(root.join("b.md")).unwrap(), b"# b0\n");
    io.run(&start, &Manifest::new()).unwrap();
    let h0 = io.head().unwrap();
    let remote = io.observe(&h0).unwrap();
    assert_eq!(remote, local);
    for path in ["large.md", "attachment.png"] {
        assert_eq!(
            io.read_remote(&h0, path).unwrap(),
            fs::read(root.join(path)).unwrap()
        );
    }
    fs::write(root.join("a.md"), b"# a1\n").unwrap();
    io.observed = remote.clone();
    io.publish(
        &h0,
        &BTreeMap::from([("b.md".into(), Some(b"# b1\n".to_vec()))]),
    )
    .unwrap();
    assert_eq!(io.read_remote(&h0, "b.md").unwrap(), b"# b0\n");
    let result = io.run(&h0, &remote);
    if io.binding.provider == "gitlab" {
        assert!(result.unwrap().remote_pending);
        assert_eq!(io.baseline["b.md"], content_digest(b"# b0\n"));
    } else {
        assert!(
            result.is_err(),
            "GitHub must reject the obsolete expectedHeadOid"
        );
    }
    let head = io.head().unwrap();
    let observed = io.observe(&head).unwrap();
    assert!(io.run(&head, &observed).unwrap().conflicts.is_empty());
    assert_eq!(fs::read(root.join("b.md")).unwrap(), b"# b1\n");
    let final_head = io.head().unwrap();
    let final_remote = io.observe(&final_head).unwrap();
    assert_eq!(final_remote, io.local());
    fs::write(parent.join("live-result.json"),serde_json::to_vec_pretty(&json!({"status":"PASS","provider":io.binding.provider,"owner":io.binding.owner,"repo":io.binding.repo,"branch":run_id,"initialHead":start,"frozenHead":h0,"finalHead":final_head,"checkpoints":io.checkpoints,"scope":"Real provider adapters and production coordinator with real temporary filesystem. Application Keychain credential. Not installed-GUI acceptance.","cleanup":"Delete only the exact owned temporary branch after retaining this evidence; retain the sandbox repository."})).unwrap()).unwrap();
}
