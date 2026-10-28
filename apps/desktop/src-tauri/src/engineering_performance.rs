#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::{document_save, repository::store};
use serde_json::json;
use std::{fs, time::Instant};

/// Opt-in observations exercise production IO; they are not timing-sensitive unit gates.
#[test]
#[ignore = "Run alone with POLARBEAR_PERF_OUTPUT set to an evidence JSON path"]
fn native_io_observations() {
    let output = std::env::var("POLARBEAR_PERF_OUTPUT").expect("Evidence output is required");
    let root = std::env::temp_dir().join(format!("polarbear-perf-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("node_modules/deep")).unwrap();
    for index in 0..2_000 {
        fs::write(
            root.join(format!("node_modules/deep/{index}.md")),
            b"excluded",
        )
        .unwrap();
    }
    let mut rows = Vec::new();
    for size in [4_096, 1_048_576, 10_485_760] {
        let content = vec![b'a'; size];
        let path = root.join("document.md");
        let mut revision = document_save::save(
            &path,
            &content,
            None,
            document_save::SaveTarget::ReplaceOrCreate,
        )
        .unwrap()
        .revision;
        fs::write(root.join("attachment.png"), &content).unwrap();
        for round in 0..6 {
            let start = Instant::now();
            revision = document_save::save(
                &path,
                &content,
                Some(&revision),
                document_save::SaveTarget::Existing,
            )
            .unwrap()
            .revision;
            let save_ms = start.elapsed().as_secs_f64() * 1_000.0;
            let start = Instant::now();
            let files = store::scan_sync_files(&root, &root).unwrap();
            let digests = files
                .values()
                .map(|path| store::file_digest(path).unwrap())
                .collect::<Vec<_>>();
            let scan_ms = start.elapsed().as_secs_f64() * 1_000.0;
            rows.push(json!({"size": size, "round": round, "warmup": round == 0,
                "saveMs": save_ms, "scanAndHashMs": scan_ms, "files": files.len(),
                "digestBytes": digests.iter().map(String::len).sum::<usize>()}));
        }
    }
    fs::remove_dir_all(root).unwrap();
    fs::write(output, serde_json::to_vec_pretty(&json!({"rows": rows, "scope": "Temporary files; real save and scan/digest. No network, UI or SQLite cache timing."})).unwrap()).unwrap();
}

/// Independent probes attribute costs; they must not be added to production scan totals.
#[test]
#[ignore = "Run alone with POLARBEAR_PROFILE_OUTPUT set"]
fn native_stage_profile() {
    use crate::repository::{model::RepositoryBindingDto, policy::content_digest};
    use std::collections::BTreeMap;
    let output = std::env::var("POLARBEAR_PROFILE_OUTPUT").unwrap();
    let root = std::env::temp_dir().join(format!("polarbear-profile-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("workspace/node_modules/deep")).unwrap();
    let workspace = root.join("workspace");
    for n in 0..2_000 {
        fs::write(
            workspace.join(format!("node_modules/deep/{n}.md")),
            b"excluded",
        )
        .unwrap();
    }
    let mut rows = Vec::new();
    for size in [4096, 1_048_576, 10_485_760] {
        let content = vec![b'a'; size];
        fs::write(workspace.join("document.md"), &content).unwrap();
        fs::write(workspace.join("attachment.png"), &content).unwrap();
        for round in 0..6 {
            let start = Instant::now();
            let files = store::scan_sync_files(&workspace, &workspace).unwrap();
            let enumerate_ms = start.elapsed().as_secs_f64() * 1000.;
            let start = Instant::now();
            let manifest = files
                .iter()
                .map(|(p, f)| (p.clone(), store::file_digest(f).unwrap()))
                .collect::<BTreeMap<_, _>>();
            let stream_hash_ms = start.elapsed().as_secs_f64() * 1000.;
            let start = Instant::now();
            let buffers = files
                .values()
                .map(|f| fs::read(f).unwrap())
                .collect::<Vec<_>>();
            let read_probe_ms = start.elapsed().as_secs_f64() * 1000.;
            let start = Instant::now();
            let hashes = buffers
                .iter()
                .map(|b| content_digest(b))
                .collect::<Vec<_>>();
            let hash_probe_ms = start.elapsed().as_secs_f64() * 1000.;
            assert_eq!(hashes, manifest.values().cloned().collect::<Vec<_>>());
            let binding:RepositoryBindingDto=serde_json::from_value(json!({"workspaceRef":workspace.to_str().unwrap(),"provider":"gitlab","owner":"fixture","repo":"fixture","branch":"main","remotePath":"","manifest":manifest,"hasSynced":true})).unwrap();
            let bindings = BTreeMap::from([(binding.workspace_ref.clone(), binding)]);
            let start = Instant::now();
            crate::cloud_sync_store::replace_bindings(&root.join("baseline.sqlite3"), &bindings)
                .unwrap();
            let checkpoint_probe_ms = start.elapsed().as_secs_f64() * 1000.;
            rows.push(json!({"size":size,"round":round,"warmup":round==0,"enumerateMs":enumerate_ms,"streamReadAndHashMs":stream_hash_ms,"independentReadMs":read_probe_ms,"independentMemoryHashMs":hash_probe_ms,"independentCheckpointMs":checkpoint_probe_ms,"digestBytes":manifest.values().map(String::len).sum::<usize>(),"databaseBytes":fs::metadata(root.join("baseline.sqlite3")).unwrap().len()}));
        }
    }
    fs::remove_dir_all(&root).unwrap();
    fs::write(output,serde_json::to_vec_pretty(&json!({"rows":rows,"scope":"Production enumeration, streaming hash and SQLite binding checkpoint. Independent memory/read probes are attribution only, not additive sync phases. No network, installed-app CPU/RSS or cache-hit claim."})).unwrap()).unwrap();
}
