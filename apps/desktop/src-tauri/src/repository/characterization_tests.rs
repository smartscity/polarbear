#![allow(clippy::unwrap_used)]

use super::{
    model::RepositoryBindingDto,
    policy::{
        content_digest, github_content_url, manifest_change_count, relative_sync_path,
        remote_manifest_changed,
    },
    provider::{github_put, gitlab_file_id, gitlab_project_path, normalize_gitlab_base_url},
    store::scan_sync_files,
};
use reqwest::blocking::Client;
use std::{collections::BTreeMap, fs, time::Duration};

fn binding() -> RepositoryBindingDto {
    RepositoryBindingDto {
        workspace_ref: "/fixture".into(),
        provider: "github".into(),
        owner: "owner".into(),
        repo: "notes".into(),
        branch: "feature/notes".into(),
        remote_path: "/docs/".into(),
        base_url: None,
        last_sync_commit_sha: None,
        last_sync_at: None,
        has_synced: false,
        manifest: BTreeMap::new(),
    }
}

#[test]
fn provider_paths_preserve_scoping_and_component_encoding() {
    let binding = binding();
    assert_eq!(
        github_content_url(&binding, "a b/#note.md"),
        "https://api.github.com/repos/owner/notes/contents/docs/a%20b/%23note.md"
    );
    assert_eq!(
        relative_sync_path(&binding, "docs/one.md"),
        Some("one.md".into())
    );
    assert_eq!(relative_sync_path(&binding, "docs-other/one.md"), None);
    assert_eq!(
        relative_sync_path(&binding, "docs/node_modules/one.md"),
        None
    );
    assert_eq!(relative_sync_path(&binding, "docs/app.exe"), None);
    assert_eq!(
        gitlab_project_path("team/subgroup", "notes"),
        "team/subgroup/notes"
    );
    assert_eq!(gitlab_file_id("docs/a b.md"), "docs%2Fa%20b.md");
    assert_eq!(
        normalize_gitlab_base_url(Some(" https://git.example/ ")),
        "https://git.example"
    );
}

#[test]
fn binding_wire_format_and_legacy_defaults_remain_compatible() {
    let mut value = serde_json::to_value(binding()).unwrap();
    assert_eq!(value["workspaceRef"], "/fixture");
    assert_eq!(value["remotePath"], "/docs/");
    assert_eq!(value["hasSynced"], false);
    value.as_object_mut().unwrap().remove("hasSynced");
    let restored: RepositoryBindingDto = serde_json::from_value(value).unwrap();
    assert!(!restored.has_synced);
    assert_eq!(restored.branch, "feature/notes");
}

#[test]
fn manifests_count_additions_changes_and_deletions_once() {
    let before = BTreeMap::from([
        ("same.md".into(), "a".into()),
        ("changed.md".into(), "a".into()),
        ("deleted.md".into(), "a".into()),
    ]);
    let after = BTreeMap::from([
        ("same.md".into(), "a".into()),
        ("changed.md".into(), "b".into()),
        ("added.md".into(), "a".into()),
    ]);
    assert_eq!(manifest_change_count(&after, &before), 3);
    assert!(remote_manifest_changed(&after, &before));
    assert!(!remote_manifest_changed(&before, &before));
    assert_eq!(content_digest(b"abc"), "3:YWJj");
}

#[cfg(unix)]
#[test]
fn local_sync_scan_skips_links_and_excluded_files() {
    let root = std::env::temp_dir().join(format!("polarbear-sync-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("node_modules")).unwrap();
    fs::write(root.join("note.md"), "fixture").unwrap();
    fs::write(root.join("node_modules/hidden.md"), "fixture").unwrap();
    fs::write(root.join("private.txt"), "fixture").unwrap();
    std::os::unix::fs::symlink(root.join("note.md"), root.join("linked.md")).unwrap();
    let files = scan_sync_files(&root, &root).unwrap();
    assert_eq!(files.keys().collect::<Vec<_>>(), [&"note.md".to_owned()]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn provider_http_errors_preserve_authentication_and_permission_diagnostics() {
    use std::io::{Read, Write};
    for (status, message) in [
        (401, "Reconnect Cloud Sync"),
        (403, "Contents to Read and write"),
    ] {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let size = stream.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..size]).starts_with("PUT /contents"));
            let body = r#"{"message":"fixture rejection"}"#;
            write!(stream, "HTTP/1.1 {status} Rejected\r\nContent-Length: {}\r\nConnection: close\r\nx-github-request-id: fixture\r\n\r\n{body}", body.len()).unwrap();
        });
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let error = github_put::<_, serde_json::Value>(
            &client,
            &format!("http://{address}/contents"),
            &serde_json::json!({"content": "fixture"}),
        )
        .unwrap_err();
        server.join().unwrap();
        assert!(error.contains(message));
        assert!(error.contains("fixture"));
    }
}
