#![allow(clippy::unwrap_used)]
use super::{
    conditional_publish::{github_publish, gitlab_publish},
    model::RepositoryBindingDto,
    sync_plan::Manifest,
};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::Duration,
};

fn binding(provider: &str) -> RepositoryBindingDto {
    serde_json::from_value(json!({"workspaceRef":"/fixture", "provider":provider, "owner":"owner", "repo":"notes", "branch":"main", "remotePath":"docs", "manifest":{}})).unwrap()
}

fn server(responses: Vec<Option<Value>>) -> (String, thread::JoinHandle<Vec<(String, Value)>>) {
    server_with_status(responses.into_iter().map(|value| (200, value)).collect())
}

fn server_with_status(
    responses: Vec<(u16, Option<Value>)>,
) -> (String, thread::JoinHandle<Vec<(String, Value)>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let thread = thread::spawn(move || {
        let mut requests = Vec::new();
        for (status, response) in responses {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let (header_end, length) = loop {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .map(str::to_owned)
                        })
                        .map(|s| s.parse::<usize>().unwrap())
                        .unwrap_or(0);
                    break (end + 4, length);
                }
            };
            while bytes.len() < header_end + length {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
            }
            let headers = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
            let body = if length == 0 {
                Value::Null
            } else {
                serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap()
            };
            requests.push((headers, body));
            if let Some(response) = response {
                let body = response.to_string();
                write!(
                    socket,
                    "HTTP/1.1 {status} Response\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
        }
        requests
    });
    (url, thread)
}

fn client() -> Client {
    Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
}

#[test]
fn github_publishes_one_atomic_batch_with_the_planned_head_and_returns_its_commit() {
    let (url, server) = server(vec![Some(
        json!({"data":{"createCommitOnBranch":{"commit":{"oid":"acknowledged"}}}}),
    )]);
    let changes = BTreeMap::from([
        ("a.md".into(), Some(b"local".to_vec())),
        ("b.md".into(), None),
    ]);
    assert_eq!(
        github_publish(
            &client(),
            &url,
            &binding("github"),
            "planned-head",
            &changes
        )
        .unwrap(),
        "acknowledged"
    );
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 1);
    let input = &requests[0].1["variables"]["input"];
    assert_eq!(input["expectedHeadOid"], "planned-head");
    assert_eq!(input["fileChanges"]["additions"][0]["path"], "docs/a.md");
    assert_eq!(input["fileChanges"]["deletions"][0]["path"], "docs/b.md");
}

#[test]
fn github_conflict_and_unknown_outcome_never_retry_with_a_new_head() {
    for response in [Some(json!({"errors":[{"message":"Head changed"}]})), None] {
        let lost = response.is_none();
        let (url, server) = server(vec![response]);
        let error = github_publish(
            &client(),
            &url,
            &binding("github"),
            "planned-head",
            &BTreeMap::new(),
        )
        .unwrap_err();
        assert!(error.contains(if lost { "unknown" } else { "rejected" }));
        assert_eq!(server.join().unwrap().len(), 1);
    }
}

#[test]
fn gitlab_conditions_updates_on_file_versions_read_from_the_frozen_commit() {
    let (url, server) = server(vec![
        Some(json!({"last_commit_id":"file-at-frozen-head"})),
        Some(json!({"id":"acknowledged"})),
    ]);
    let changes = BTreeMap::from([("a.md".into(), Some(b"local".to_vec()))]);
    let remote = Manifest::from([("a.md".into(), "digest".into())]);
    assert_eq!(
        gitlab_publish(
            &client(),
            &url,
            &binding("gitlab"),
            "planned-head",
            &remote,
            &changes
        )
        .unwrap(),
        "acknowledged"
    );
    let requests = server.join().unwrap();
    assert!(requests[0].0.contains("ref=planned-head"));
    assert_eq!(
        requests[1].1["actions"][0]["last_commit_id"],
        "file-at-frozen-head"
    );
    assert_eq!(requests[1].1["branch"], "main");
    assert!(requests[1].1.get("force").is_none());
}

struct GitlabSyncFixture {
    root: std::path::PathBuf,
    baseline: Manifest,
    remote: BTreeMap<String, Vec<u8>>,
    concurrent: BTreeMap<String, Option<Vec<u8>>>,
    checkpoints: Vec<bool>,
    fail_download: bool,
    edit_during_download: bool,
    lose_receipt: bool,
    fail_checkpoint: bool,
    publications: usize,
}
impl GitlabSyncFixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("polarbear-gitlab-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("a.md"), b"a1").unwrap();
        std::fs::write(root.join("b.md"), b"b0").unwrap();
        Self {
            root,
            baseline: Manifest::from([
                ("a.md".into(), super::policy::content_digest(b"a0")),
                ("b.md".into(), super::policy::content_digest(b"b0")),
            ]),
            remote: BTreeMap::from([
                ("a.md".into(), b"a0".to_vec()),
                ("b.md".into(), b"b0".to_vec()),
            ]),
            concurrent: BTreeMap::from([("b.md".into(), Some(b"b1".to_vec()))]),
            checkpoints: vec![],
            fail_download: false,
            edit_during_download: false,
            lose_receipt: false,
            fail_checkpoint: false,
            publications: 0,
        }
    }
    fn run(&mut self) -> Result<super::sync_coordinator::SyncOutcome, String> {
        let local = super::store::scan_sync_files(&self.root, &self.root)?
            .into_iter()
            .map(|(p, f)| Ok((p, super::store::file_digest(&f)?)))
            .collect::<Result<Manifest, String>>()?;
        let remote = self
            .remote
            .iter()
            .map(|(p, b)| (p.clone(), super::policy::content_digest(b)))
            .collect();
        super::sync_coordinator::synchronize(
            self,
            &self.baseline.clone(),
            &local,
            &remote,
            "frozen-head",
            true,
            false,
        )
    }
}
impl Drop for GitlabSyncFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
impl super::sync_coordinator::SyncIo for GitlabSyncFixture {
    fn read_local(&mut self, path: &str, _: usize) -> Result<Vec<u8>, String> {
        std::fs::read(self.root.join(path)).map_err(|e| e.to_string())
    }
    fn read_remote(&mut self, commit: &str, path: &str) -> Result<Vec<u8>, String> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let body = self.remote[path].clone();
        let fail = self.fail_download;
        let expected_path = format!(
            "/repository/files/docs%2F{}%2Emd/raw?ref={commit}",
            path.trim_end_matches(".md")
        );
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let n = socket.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..n]);
            assert!(request.contains("ref=frozen-head"), "{request}");
            // Percent encoding is supplied by the production path adapter.
            assert!(
                request.contains("/repository/files/"),
                "{expected_path}: {request}"
            );
            if fail {
                socket.write_all(b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            } else {
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .unwrap();
                socket.write_all(&body).unwrap();
            }
        });
        if self.edit_during_download {
            std::fs::write(self.root.join(path), b"local-late").unwrap();
        }
        let mut binding = binding("gitlab");
        binding.base_url = Some(endpoint);
        binding.branch = commit.into();
        let result = super::provider::gitlab_download_file(&client(), &binding, path);
        server.join().unwrap();
        result
    }
    fn apply_local(
        &mut self,
        path: &str,
        expected: Option<&str>,
        content: Option<&[u8]>,
    ) -> Result<(), String> {
        crate::document_save::apply_sync_change(
            self.root.to_str().unwrap(),
            path,
            expected,
            content,
        )
    }
    fn publish(
        &mut self,
        commit: &str,
        changes: &BTreeMap<String, Option<Vec<u8>>>,
    ) -> Result<super::sync_coordinator::PublishedCommit, String> {
        let remote = self
            .remote
            .iter()
            .map(|(p, b)| (p.clone(), super::policy::content_digest(b)))
            .collect::<Manifest>();
        let mut replies = Vec::new();
        for p in changes.keys() {
            if remote.contains_key(p) {
                replies.push(Some(json!({"last_commit_id":"file-at-frozen-head"})));
            }
        }
        replies.push(if self.lose_receipt {
            None
        } else {
            Some(json!({"id":"receipt-head"}))
        });
        let (url, http) = server(replies);
        let receipt = gitlab_publish(
            &client(),
            &url,
            &binding("gitlab"),
            commit,
            &remote,
            changes,
        );
        let requests = http.join().unwrap();
        assert!(requests.last().unwrap().1.get("force").is_none());
        for (path, bytes) in std::mem::take(&mut self.concurrent)
            .iter()
            .chain(changes.iter())
        {
            if let Some(bytes) = bytes {
                self.remote.insert(path.clone(), bytes.clone());
            } else {
                self.remote.remove(path);
            }
        }
        self.publications += 1;
        receipt.map(super::sync_coordinator::PublishedCommit::ChangedPaths)
    }
    fn checkpoint(&mut self, baseline: &Manifest, _: &str, complete: bool) -> Result<(), String> {
        if self.fail_checkpoint {
            return Err("checkpoint unavailable".into());
        }
        self.baseline = baseline.clone();
        self.checkpoints.push(complete);
        Ok(())
    }
}

#[test]
fn gitlab_receipt_never_certifies_an_unobserved_unrelated_remote_edit() {
    let mut f = GitlabSyncFixture::new();
    assert!(f.run().unwrap().remote_pending);
    assert_eq!(f.checkpoints, [false]);
    assert_eq!(f.baseline["a.md"], super::policy::content_digest(b"a1"));
    assert_eq!(f.baseline["b.md"], super::policy::content_digest(b"b0"));
    assert_eq!(std::fs::read(f.root.join("b.md")).unwrap(), b"b0");
    f.run().unwrap();
    assert_eq!(std::fs::read(f.root.join("b.md")).unwrap(), b"b1");
    assert_eq!(f.checkpoints.last(), Some(&true));
    assert_eq!(f.publications, 1);
}

#[test]
fn gitlab_confirmation_download_failure_retains_old_baseline_and_retries_pull() {
    let mut f = GitlabSyncFixture::new();
    f.run().unwrap();
    f.fail_download = true;
    assert!(f.run().is_err());
    assert_eq!(f.baseline["b.md"], super::policy::content_digest(b"b0"));
    f.fail_download = false;
    f.run().unwrap();
    assert_eq!(std::fs::read(f.root.join("b.md")).unwrap(), b"b1");
    assert_eq!(f.publications, 1);
}

#[test]
fn gitlab_confirmation_preserves_local_edits_during_application() {
    let mut f = GitlabSyncFixture::new();
    f.run().unwrap();
    f.edit_during_download = true;
    assert!(f.run().is_err());
    assert_eq!(std::fs::read(f.root.join("b.md")).unwrap(), b"local-late");
    assert_eq!(f.baseline["b.md"], super::policy::content_digest(b"b0"));
    f.edit_during_download = false;
    assert_eq!(f.run().unwrap().conflicts, ["b.md"]);
}

#[test]
fn gitlab_unrelated_create_and_delete_are_reconciled_only_on_the_next_snapshot() {
    let mut f = GitlabSyncFixture::new();
    f.concurrent = BTreeMap::from([
        ("b.md".into(), None),
        ("c.md".into(), Some(b"created".to_vec())),
    ]);
    f.run().unwrap();
    assert!(f.baseline.contains_key("b.md"));
    assert!(!f.baseline.contains_key("c.md"));
    f.run().unwrap();
    assert!(!f.root.join("b.md").exists());
    assert_eq!(std::fs::read(f.root.join("c.md")).unwrap(), b"created");
    assert_eq!(f.publications, 1);
}

#[test]
fn gitlab_unknown_receipt_and_checkpoint_failure_reconcile_without_duplicate_upload() {
    for lost in [true, false] {
        let mut f = GitlabSyncFixture::new();
        f.lose_receipt = lost;
        f.fail_checkpoint = !lost;
        assert!(f.run().is_err());
        assert_eq!(f.baseline["a.md"], super::policy::content_digest(b"a0"));
        f.lose_receipt = false;
        f.fail_checkpoint = false;
        f.run().unwrap();
        assert_eq!(std::fs::read(f.root.join("b.md")).unwrap(), b"b1");
        assert_eq!(f.publications, 1);
    }
}

#[test]
fn gitlab_rejects_a_changed_file_version_without_retrying_or_dropping_its_guard() {
    let (url, http) = server_with_status(vec![
        (200, Some(json!({"last_commit_id":"a-at-frozen-head"}))),
        (400, Some(json!({"message":"file changed"}))),
    ]);
    let changes = BTreeMap::from([("a.md".into(), Some(b"a1".to_vec()))]);
    let remote = Manifest::from([("a.md".into(), "old-digest".into())]);
    let error = gitlab_publish(
        &client(),
        &url,
        &binding("gitlab"),
        "frozen-head",
        &remote,
        &changes,
    )
    .unwrap_err();
    assert!(error.contains("rejected"));
    let requests = http.join().unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(
        requests[1].1["actions"][0]["last_commit_id"],
        "a-at-frozen-head"
    );
}
