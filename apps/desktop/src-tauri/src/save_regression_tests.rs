use super::{content_revision, save_markdown_file_content, write_markdown_file};
use std::cell::RefCell;
use std::fs;
#[cfg(target_os = "macos")]
use std::path::Path;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

thread_local! {
    static BEFORE_REPLACE: RefCell<Option<Box<dyn FnOnce()>>> = RefCell::new(None);
}

pub(super) fn before_replace() {
    BEFORE_REPLACE.with(|hook| {
        let callback = hook.borrow_mut().take();
        if let Some(callback) = callback {
            callback();
        }
    });
}

struct Workspace(PathBuf);

impl Workspace {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("polarbear-save-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("note.md"), "original").unwrap();
        Self(root)
    }

    fn path(&self) -> PathBuf {
        self.0.join("note.md")
    }
    fn root(&self) -> &str {
        self.0.to_str().unwrap()
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn outbox_failure_acknowledges_the_committed_revision_and_allows_the_next_save() {
    let workspace = Workspace::new();
    // A directory at the SQLite path deterministically fails without touching user data.
    let invalid_database = workspace.0.join("outbox.sqlite");
    fs::create_dir(&invalid_database).unwrap();
    let saved = super::save_markdown_file_with_outbox(
        workspace.root(),
        "note.md",
        "committed",
        Some(&content_revision(b"original")),
        || {
            super::cloud_sync_store::queue_outbox_path(
                &invalid_database,
                workspace.root(),
                "note.md",
                "upload",
            )
        },
    );
    assert_eq!(fs::read_to_string(workspace.path()).unwrap(), "committed");
    let saved = saved.expect("outbox failure must not reject a committed local save");
    assert_eq!(saved.revision, content_revision(b"committed"));
    let payload = serde_json::to_value(&saved).unwrap();
    assert_eq!(payload["warning"], "workspace.syncQueueUnavailable");
    let next = super::save_markdown_file_with_outbox(
        workspace.root(),
        "note.md",
        "next edit",
        Some(&saved.revision),
        || Ok(()),
    )
    .unwrap();
    assert_eq!(next.revision, content_revision(b"next edit"));
    assert!(serde_json::to_value(next).unwrap().get("warning").is_none());
}

#[test]
fn a_rejected_local_save_does_not_enqueue_sync_work() {
    let workspace = Workspace::new();
    let error = super::save_markdown_file_with_outbox(
        workspace.root(),
        "note.md",
        "stale",
        Some("stale revision"),
        || panic!("sync work must only follow a committed save"),
    )
    .unwrap_err();
    assert_eq!(error.code, "workspace.documentChanged");
    assert_eq!(fs::read_to_string(workspace.path()).unwrap(), "original");
}

#[test]
fn successful_outbox_write_preserves_the_legacy_success_shape() {
    let workspace = Workspace::new();
    let database = workspace.0.join("outbox.sqlite");
    let binding = super::RepositoryBindingDto {
        workspace_ref: workspace.root().to_owned(),
        provider: "github".to_owned(),
        owner: "fixture".to_owned(),
        repo: "fixture".to_owned(),
        branch: "main".to_owned(),
        remote_path: String::new(),
        base_url: None,
        last_sync_commit_sha: None,
        last_sync_at: None,
        has_synced: false,
        manifest: Default::default(),
    };
    super::cloud_sync_store::replace_bindings(
        &database,
        &[(workspace.root().to_owned(), binding)]
            .into_iter()
            .collect(),
    )
    .unwrap();
    let saved =
        super::save_markdown_file_with_outbox(workspace.root(), "note.md", "saved", None, || {
            super::cloud_sync_store::queue_outbox_path(
                &database,
                workspace.root(),
                "note.md",
                "upload",
            )
        })
        .unwrap();
    assert_eq!(
        serde_json::to_value(saved).unwrap(),
        serde_json::json!({"revision": content_revision(b"saved")})
    );
    assert_eq!(
        super::cloud_sync_store::read_outbox(&database, workspace.root())
            .unwrap()
            .get("note.md")
            .unwrap(),
        "upload"
    );
}

#[test]
fn concurrent_workspace_and_absolute_saves_commit_only_one_revision() {
    let workspace = Workspace::new();
    let root = workspace.root().to_owned();
    let path = workspace.path().to_string_lossy().into_owned();
    let revision = content_revision(b"original");
    let first_revision = revision.clone();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let first = std::thread::spawn(move || {
        BEFORE_REPLACE.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            }))
        });
        save_markdown_file_content(&root, "note.md", "first writer", Some(&first_revision))
    });
    entered_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let (finished_tx, finished_rx) = mpsc::channel();
    let second = std::thread::spawn(move || {
        let result = write_markdown_file(path, "second writer".to_owned(), Some(revision));
        finished_tx.send(()).unwrap();
        result
    });
    // Hold the first writer after revision validation, then overlap the other entry point.
    let finished_before_release = finished_rx.recv_timeout(Duration::from_millis(200)).is_ok();
    release_tx.send(()).unwrap();
    first.join().unwrap().unwrap();
    let second_result = second.join().unwrap();
    assert!(
        !finished_before_release,
        "the second save bypassed the active save transaction"
    );
    assert_eq!(second_result.unwrap_err().code, "workspace.documentChanged");
    assert_eq!(
        fs::read_to_string(workspace.path()).unwrap(),
        "first writer"
    );
}

#[cfg(unix)]
#[test]
fn save_preserves_private_file_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let workspace = Workspace::new();
    fs::set_permissions(workspace.path(), fs::Permissions::from_mode(0o600)).unwrap();
    save_markdown_file_content(workspace.root(), "note.md", "private", None).unwrap();
    assert_eq!(
        fs::metadata(workspace.path()).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[cfg(unix)]
#[test]
fn save_does_not_replace_a_read_only_file_in_a_writable_directory() {
    use std::os::unix::fs::PermissionsExt;
    let workspace = Workspace::new();
    fs::set_permissions(workspace.path(), fs::Permissions::from_mode(0o444)).unwrap();
    let result = save_markdown_file_content(workspace.root(), "note.md", "changed", None);
    assert!(
        result.is_err(),
        "atomic replacement must not bypass target write permission"
    );
    assert_eq!(fs::read_to_string(workspace.path()).unwrap(), "original");
    assert_eq!(fs::read_dir(&workspace.0).unwrap().count(), 1);
}

#[cfg(target_os = "macos")]
fn run(program: &str, args: &[&str], path: &Path) -> String {
    let result = std::process::Command::new(program)
        .args(args)
        .arg(path)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    String::from_utf8(result.stdout).unwrap()
}

#[cfg(target_os = "macos")]
#[test]
fn save_preserves_macos_extended_attributes_and_acl() {
    let workspace = Workspace::new();
    run(
        "/usr/bin/xattr",
        &["-w", "com.polarbear.save-test", "keep-me"],
        &workspace.path(),
    );
    run(
        "/bin/chmod",
        &["+a", "everyone allow readattr"],
        &workspace.path(),
    );
    let acl_before = run("/bin/ls", &["-le"], &workspace.path())
        .lines()
        .skip(1)
        .collect::<Vec<_>>()
        .join("\n");
    let result = save_markdown_file_content(workspace.root(), "note.md", "updated", None);
    let xattr = std::process::Command::new("/usr/bin/xattr")
        .args(["-p", "com.polarbear.save-test"])
        .arg(workspace.path())
        .output()
        .unwrap();
    let acl_after = run("/bin/ls", &["-le"], &workspace.path())
        .lines()
        .skip(1)
        .collect::<Vec<_>>()
        .join("\n");
    run("/bin/chmod", &["-N"], &workspace.path());
    result.unwrap();
    assert!(xattr.status.success(), "extended attributes were lost");
    assert_eq!(String::from_utf8(xattr.stdout).unwrap().trim(), "keep-me");
    assert_eq!(acl_before, acl_after);
}

#[test]
fn save_rechecks_external_changes_before_replacement_and_cleans_staging() {
    let workspace = Workspace::new();
    let path = workspace.path();
    BEFORE_REPLACE.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move || {
            fs::write(path, "external writer").unwrap();
        }))
    });
    let error = save_markdown_file_content(
        workspace.root(),
        "note.md",
        "local writer",
        Some(&content_revision(b"original")),
    )
    .unwrap_err();
    assert_eq!(error.code, "workspace.documentChanged");
    assert_eq!(
        fs::read_to_string(workspace.path()).unwrap(),
        "external writer"
    );
    assert_eq!(fs::read_dir(&workspace.0).unwrap().count(), 1);
}

#[test]
fn save_does_not_recreate_a_file_deleted_during_staging() {
    let workspace = Workspace::new();
    let path = workspace.path();
    BEFORE_REPLACE.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move || {
            fs::remove_file(path).unwrap();
        }))
    });
    let error =
        save_markdown_file_content(workspace.root(), "note.md", "local writer", None).unwrap_err();
    assert_eq!(error.code, "workspace.documentMissing");
    assert_eq!(fs::read_dir(&workspace.0).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn absolute_save_rejects_symlink_targets() {
    let workspace = Workspace::new();
    let link = workspace.0.join("linked.md");
    std::os::unix::fs::symlink(workspace.path(), &link).unwrap();
    assert!(
        write_markdown_file(link.to_string_lossy().into_owned(), "changed".into(), None).is_err()
    );
    assert_eq!(fs::read_to_string(workspace.path()).unwrap(), "original");
    assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
}

#[cfg(target_os = "macos")]
#[test]
fn save_enforces_target_acl_and_leaves_no_temporary_file() {
    let workspace = Workspace::new();
    run(
        "/bin/chmod",
        &["+a", "everyone deny write"],
        &workspace.path(),
    );
    let result = save_markdown_file_content(workspace.root(), "note.md", "changed", None);
    run("/bin/chmod", &["-N"], &workspace.path());
    assert_eq!(result.unwrap_err().code, "workspace.permissionDenied");
    assert_eq!(fs::read_to_string(workspace.path()).unwrap(), "original");
    assert_eq!(fs::read_dir(&workspace.0).unwrap().count(), 1);
}

#[test]
fn new_absolute_save_succeeds_without_a_revision() {
    let workspace = Workspace::new();
    let path = workspace.0.join("new.md");
    let saved = write_markdown_file(
        path.to_string_lossy().into_owned(),
        "new document".into(),
        None,
    )
    .unwrap();
    assert_eq!(saved.revision, content_revision(b"new document"));
    assert_eq!(fs::read_to_string(path).unwrap(), "new document");
    assert_eq!(fs::read_dir(&workspace.0).unwrap().count(), 2);
}

#[cfg(unix)]
#[test]
fn save_handles_parent_permission_failure_without_changing_original() {
    use std::os::unix::fs::PermissionsExt;
    let workspace = Workspace::new();
    fs::set_permissions(&workspace.0, fs::Permissions::from_mode(0o500)).unwrap();
    let result = save_markdown_file_content(workspace.root(), "note.md", "changed", None);
    fs::set_permissions(&workspace.0, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(result.unwrap_err().code, "workspace.permissionDenied");
    assert_eq!(fs::read_to_string(workspace.path()).unwrap(), "original");
    assert_eq!(fs::read_dir(&workspace.0).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn save_as_reports_permission_denied_when_it_cannot_create_the_parent() {
    use std::os::unix::fs::PermissionsExt;
    let workspace = Workspace::new();
    fs::set_permissions(&workspace.0, fs::Permissions::from_mode(0o500)).unwrap();
    let result = write_markdown_file(
        workspace
            .0
            .join("nested/new.md")
            .to_string_lossy()
            .into_owned(),
        "new".into(),
        None,
    );
    fs::set_permissions(&workspace.0, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(result.unwrap_err().code, "workspace.permissionDenied");
    assert!(!workspace.0.join("nested").exists());
}

#[test]
fn create_only_transaction_cannot_replace_an_existing_document() {
    let workspace = Workspace::new();
    let result = crate::document_save::save(
        &workspace.path(),
        b"new",
        None,
        crate::document_save::SaveTarget::CreateNew,
    );
    assert_eq!(result.unwrap_err().code, "workspace.documentChanged");
    assert_eq!(fs::read_to_string(workspace.path()).unwrap(), "original");
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "Invoked as an isolated process by saves_coordinate_across_native_processes"]
fn coordinated_save_process_fixture() {
    let root = std::env::var("POLARBEAR_SAVE_FIXTURE_ROOT").unwrap();
    let role = std::env::var("POLARBEAR_SAVE_FIXTURE_ROLE").unwrap();
    let folder = PathBuf::from(&root);
    if role == "first" {
        let folder = folder.clone();
        BEFORE_REPLACE.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                fs::write(folder.join("ready-first"), "ready").unwrap();
                wait_for_file(&folder.join("release"));
            }))
        });
    }
    fs::write(folder.join(format!("started-{role}")), "started").unwrap();
    let result = save_markdown_file_content(
        &root,
        "note.md",
        &role,
        Some(&content_revision(b"original")),
    );
    let outcome = result.map(|_| "saved").unwrap_or_else(|error| error.code);
    fs::write(folder.join(format!("result-{role}")), outcome).unwrap();
}

#[cfg(target_os = "macos")]
fn wait_for_file(path: &Path) {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !path.exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for {}",
            path.display()
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(target_os = "macos")]
#[test]
fn saves_coordinate_across_native_processes() {
    let workspace = Workspace::new();
    let spawn = |role: &str| {
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "save_regression_tests::coordinated_save_process_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("POLARBEAR_SAVE_FIXTURE_ROOT", workspace.root())
            .env("POLARBEAR_SAVE_FIXTURE_ROLE", role)
            .spawn()
            .unwrap()
    };
    let mut first = spawn("first");
    wait_for_file(&workspace.0.join("ready-first"));
    let mut second = spawn("second");
    wait_for_file(&workspace.0.join("started-second"));
    std::thread::sleep(Duration::from_millis(150));
    let bypassed = workspace.0.join("result-second").exists();
    fs::write(workspace.0.join("release"), "release").unwrap();
    for child in [&mut first, &mut second] {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert!(status.success());
                break;
            }
            if std::time::Instant::now() >= deadline {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("save process timed out");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    assert!(
        !bypassed,
        "a separate process bypassed macOS file coordination"
    );
    assert_eq!(
        fs::read_to_string(workspace.0.join("result-first")).unwrap(),
        "saved"
    );
    assert_eq!(
        fs::read_to_string(workspace.0.join("result-second")).unwrap(),
        "workspace.documentChanged"
    );
    assert_eq!(fs::read_to_string(workspace.path()).unwrap(), "first");
}
