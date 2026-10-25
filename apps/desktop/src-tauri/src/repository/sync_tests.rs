#![allow(clippy::unwrap_used)]
use super::{
    policy::content_digest,
    sync_coordinator::{synchronize, SyncIo},
    sync_plan::Manifest,
};
use std::{collections::BTreeMap, fs, path::PathBuf};

struct Fixture {
    root: PathBuf,
    remote: BTreeMap<String, Vec<u8>>,
    baseline: Manifest,
    head: String,
    publications: usize,
    lose_response: bool,
    fail_checkpoint: bool,
    edit_during_download: bool,
    checkpoints: Vec<bool>,
}
impl Fixture {
    fn new(local: &[u8], remote: &[u8]) -> Self {
        let root =
            std::env::temp_dir().join(format!("polarbear-sync-protocol-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("note.md"), local).unwrap();
        Self {
            root,
            remote: BTreeMap::from([("note.md".into(), remote.to_vec())]),
            baseline: BTreeMap::from([("note.md".into(), content_digest(b"B"))]),
            head: "frozen-head".into(),
            publications: 0,
            lose_response: false,
            fail_checkpoint: false,
            edit_during_download: false,
            checkpoints: Vec::new(),
        }
    }
    fn run(&mut self) -> Result<super::sync_coordinator::SyncOutcome, String> {
        let local = super::store::scan_sync_files(&self.root, &self.root)?
            .into_iter()
            .map(|(path, file)| Ok((path, super::store::file_digest(&file)?)))
            .collect::<Result<Manifest, String>>()?;
        let remote = self
            .remote
            .iter()
            .map(|(path, bytes)| (path.clone(), content_digest(bytes)))
            .collect();
        synchronize(
            self,
            &self.baseline.clone(),
            &local,
            &remote,
            &self.head.clone(),
            true,
            false,
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
impl SyncIo for Fixture {
    fn read_local(&mut self, path: &str, _: usize) -> Result<Vec<u8>, String> {
        fs::read(self.root.join(path)).map_err(|e| e.to_string())
    }
    fn read_remote(&mut self, commit: &str, path: &str) -> Result<Vec<u8>, String> {
        assert_eq!(commit, "frozen-head");
        if self.edit_during_download {
            fs::write(self.root.join(path), b"new local edit").unwrap();
        }
        Ok(self.remote[path].clone())
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
        expected: &str,
        changes: &BTreeMap<String, Option<Vec<u8>>>,
    ) -> Result<String, String> {
        if expected != self.head {
            return Err("remote conflict".into());
        }
        self.publications += 1;
        for (path, content) in changes {
            if let Some(content) = content {
                self.remote.insert(path.clone(), content.clone());
            } else {
                self.remote.remove(path);
            }
        }
        self.head = "published-head".into();
        if self.lose_response {
            return Err("unknown publication outcome".into());
        }
        Ok(self.head.clone())
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
fn conflicting_real_files_remain_intact_and_never_reach_publication() {
    let mut f = Fixture::new(b"L", b"R");
    assert_eq!(f.run().unwrap().conflicts, ["note.md"]);
    assert_eq!(fs::read(f.root.join("note.md")).unwrap(), b"L");
    assert_eq!(f.remote["note.md"], b"R");
    assert_eq!(f.publications, 0);
    assert_eq!(f.baseline["note.md"], content_digest(b"B"));
}

#[test]
fn local_edit_during_download_rejects_the_conditional_replace() {
    let mut f = Fixture::new(b"B", b"R");
    f.edit_during_download = true;
    assert!(f.run().is_err());
    assert_eq!(fs::read(f.root.join("note.md")).unwrap(), b"new local edit");
    assert_eq!(f.baseline["note.md"], content_digest(b"B"));
}

#[test]
fn lost_publish_response_is_reconciled_without_a_duplicate_upload() {
    let mut f = Fixture::new(b"L", b"B");
    f.lose_response = true;
    assert!(f.run().is_err());
    assert_eq!(f.publications, 1);
    assert_eq!(f.baseline["note.md"], content_digest(b"B"));
    f.lose_response = false;
    assert!(f.run().unwrap().conflicts.is_empty());
    assert_eq!(f.publications, 1);
    assert_eq!(f.baseline["note.md"], content_digest(b"L"));
}

#[test]
fn a_checkpoint_failure_after_download_recovers_without_overwriting_later_edits() {
    let mut f = Fixture::new(b"B", b"R");
    f.fail_checkpoint = true;
    assert!(f.run().is_err());
    assert_eq!(fs::read(f.root.join("note.md")).unwrap(), b"R");
    f.fail_checkpoint = false;
    fs::write(f.root.join("note.md"), b"later edit").unwrap();
    assert_eq!(f.run().unwrap().conflicts, ["note.md"]);
    assert_eq!(fs::read(f.root.join("note.md")).unwrap(), b"later edit");
}

#[test]
fn conditional_create_and_delete_do_not_overwrite_newer_files() {
    let f = Fixture::new(b"B", b"B");
    let path = f.root.join("note.md");
    assert!(crate::document_save::apply_sync_change(
        f.root.to_str().unwrap(),
        "note.md",
        None,
        Some(b"remote")
    )
    .is_err());
    assert!(crate::document_save::apply_sync_change(
        f.root.to_str().unwrap(),
        "note.md",
        Some(&content_digest(b"old")),
        None
    )
    .is_err());
    assert_eq!(fs::read(&path).unwrap(), b"B");
    crate::document_save::apply_sync_change(
        f.root.to_str().unwrap(),
        "note.md",
        Some(&content_digest(b"B")),
        None,
    )
    .unwrap();
    assert!(!path.exists());
    crate::document_save::apply_sync_change(
        f.root.to_str().unwrap(),
        "note.md",
        None,
        Some(b"remote"),
    )
    .unwrap();
    assert_eq!(fs::read(path).unwrap(), b"remote");
}

#[test]
fn overlapping_repository_operations_are_rejected_and_admission_recovers() {
    super::with_repository_operation(|| {
        let second = std::thread::spawn(|| super::with_repository_operation(|| Ok(())));
        assert!(second.join().unwrap().unwrap_err().contains("busy"));
        Err::<(), _>("first operation failed".into())
    })
    .unwrap_err();
    super::with_repository_operation(|| Ok(())).unwrap();
}

#[test]
fn unknown_upload_followed_by_a_remote_edit_preserves_the_conflict() {
    let mut f = Fixture::new(b"L", b"B");
    f.lose_response = true;
    assert!(f.run().is_err());
    f.remote
        .insert("note.md".into(), b"later remote edit".to_vec());
    f.lose_response = false;
    assert_eq!(f.run().unwrap().conflicts, ["note.md"]);
    assert_eq!(f.publications, 1);
    assert_eq!(fs::read(f.root.join("note.md")).unwrap(), b"L");
    assert_eq!(f.remote["note.md"], b"later remote edit");
}

#[test]
fn mixed_download_and_upload_checkpoint_only_acknowledged_versions() {
    let mut f = Fixture::new(b"B", b"R");
    fs::write(f.root.join("local.md"), b"local").unwrap();
    assert!(f.run().unwrap().conflicts.is_empty());
    assert_eq!(fs::read(f.root.join("note.md")).unwrap(), b"R");
    assert_eq!(f.remote["local.md"], b"local");
    assert_eq!(f.publications, 1);
    assert_eq!(f.baseline["note.md"], content_digest(b"R"));
    assert_eq!(f.baseline["local.md"], content_digest(b"local"));
    assert_eq!(f.checkpoints, [false, true]);
}

#[test]
fn oversized_atomic_publication_is_rejected_without_advancing_the_baseline() {
    let mut f = Fixture::new(&vec![b'L'; 65 * 1024 * 1024], b"B");
    assert!(f.run().is_err());
    assert_eq!(f.publications, 0);
    assert_eq!(f.baseline["note.md"], content_digest(b"B"));
}
