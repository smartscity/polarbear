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
