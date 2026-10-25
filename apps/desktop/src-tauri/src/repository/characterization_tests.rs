#![allow(clippy::unwrap_used)]

use super::{
    model::RepositoryBindingDto,
    policy::{
        content_digest, github_content_url, manifest_change_count, relative_sync_path,
        remote_manifest_changed,
    },
    provider::{gitlab_file_id, gitlab_project_path, normalize_gitlab_base_url},
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
    assert_ne!(content_digest(b"abc"), content_digest(b"abd"));
}

#[test]
fn sync_digest_is_versioned_fixed_size_and_does_not_embed_document_content() {
    assert_eq!(
        content_digest(b"abc"),
        "sha256:v1:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    let empty = content_digest(b"");
    assert_eq!(
        empty,
        "sha256:v1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        content_digest(&vec![42; 8 * 1024 * 1024]).len(),
        empty.len()
    );
    assert_ne!(
        content_digest("中文".as_bytes()),
        content_digest("字词".as_bytes())
    );
}

#[test]
fn streamed_digests_retain_the_sha256_contract_at_block_boundaries() {
    use sha2::{Digest, Sha256};
    for size in [0, 1, 55, 56, 63, 64, 65, 65_535, 65_536, 65_537, 1_048_576] {
        let bytes = (0..size)
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        let expected = format!("sha256:v1:{:x}", Sha256::digest(&bytes));
        assert_eq!(content_digest(&bytes), expected);
        assert_eq!(super::policy::stream_digest(&bytes[..]).unwrap(), expected);
    }
}

#[test]
fn legacy_baseline_migration_preserves_original_bytes_and_outbox() {
    let root = std::env::temp_dir().join(format!("polarbear-digest-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let database = root.join("sync.sqlite3");
    let mut original = binding();
    original.manifest.insert("note.md".into(), "3:YWJj".into());
    crate::cloud_sync_store::replace_bindings(
        &database,
        &BTreeMap::from([(original.workspace_ref.clone(), original.clone())]),
    )
    .unwrap();
    crate::cloud_sync_store::queue_outbox_path(
        &database,
        &original.workspace_ref,
        "note.md",
        "upload",
    )
    .unwrap();
    fs::write(root.join("note.md"), "different current local content").unwrap();
    for _ in 0..2 {
        let bindings =
            crate::cloud_sync_store::load_bindings(&database, &root.join("absent.json")).unwrap();
        assert_eq!(
            bindings[&original.workspace_ref].manifest["note.md"],
            "sha256:v1:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            crate::cloud_sync_store::read_outbox(&database, &original.workspace_ref).unwrap()
                ["note.md"],
            "upload"
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn invalid_baseline_rolls_back_migration_and_can_recover_on_restart() {
    let root = std::env::temp_dir().join(format!("polarbear-digest-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let database = root.join("sync.sqlite3");
    let mut original = binding();
    original.manifest = BTreeMap::from([
        ("a.md".into(), "3:YWJj".into()),
        ("b.md".into(), "4:YWJj".into()),
    ]);
    crate::cloud_sync_store::replace_bindings(
        &database,
        &BTreeMap::from([(original.workspace_ref.clone(), original.clone())]),
    )
    .unwrap();
    assert!(crate::cloud_sync_store::load_bindings(&database, &root.join("absent.json")).is_err());
    let connection = rusqlite::Connection::open(&database).unwrap();
    let first: String = connection
        .query_row(
            "SELECT remote_digest FROM sync_file_state WHERE relative_path='a.md'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(first, "3:YWJj");
    connection
        .execute(
            "UPDATE sync_file_state SET remote_digest='3:YWJj' WHERE relative_path='b.md'",
            [],
        )
        .unwrap();
    drop(connection);
    let recovered =
        crate::cloud_sync_store::load_bindings(&database, &root.join("absent.json")).unwrap();
    assert!(recovered[&original.workspace_ref]
        .manifest
        .values()
        .all(|digest| digest == &content_digest(b"abc")));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn streamed_digests_match_memory_digests_for_empty_unicode_and_large_files() {
    for bytes in [
        Vec::new(),
        "Unicode 中文\n".as_bytes().to_vec(),
        vec![91; 8 * 1024 * 1024],
    ] {
        assert_eq!(
            super::policy::stream_digest(std::io::Cursor::new(&bytes)).unwrap(),
            content_digest(&bytes)
        );
    }
}

#[cfg(unix)]
#[test]
fn excluded_directories_are_not_entered_even_when_unreadable() {
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!("polarbear-scan-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("node_modules")).unwrap();
    fs::set_permissions(root.join("node_modules"), fs::Permissions::from_mode(0o0)).unwrap();
    let result = scan_sync_files(&root, &root);
    fs::set_permissions(root.join("node_modules"), fs::Permissions::from_mode(0o700)).unwrap();
    fs::remove_dir_all(root).unwrap();
    assert!(result.unwrap().is_empty());
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
            assert!(String::from_utf8_lossy(&request[..size]).starts_with("POST /contents"));
            let body = r#"{"message":"fixture rejection"}"#;
            write!(stream, "HTTP/1.1 {status} Rejected\r\nContent-Length: {}\r\nConnection: close\r\nx-github-request-id: fixture\r\n\r\n{body}", body.len()).unwrap();
        });
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let error = super::conditional_publish::github_publish(
            &client,
            &format!("http://{address}/contents"),
            &binding(),
            "expected-head",
            &BTreeMap::from([("note.md".into(), Some(b"fixture".to_vec()))]),
        )
        .unwrap_err();
        server.join().unwrap();
        assert!(error.contains(message));
        assert!(error.contains("fixture"));
    }
}
