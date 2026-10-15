//! Desktop-owned delivery receipts; Vocab remains the owner of vocabulary data.
use crate::vocab_bridge::{exchange, failure, VocabError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const MAX_PENDING: i64 = 1000;
const MAX_BYTES: usize = 30 * 1024;
const POLL_SECONDS: u64 = 30;
const LEASE_SECONDS: i64 = 60;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingCapture {
    request_id: String,
    selected_text: String,
    sense_uid: Option<String>,
    sentence: String,
    title: String,
    file_path: Option<String>,
    heading: String,
    line: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    request_id: String,
    state: String,
    error: Option<String>,
}

pub struct VocabOutbox {
    database: PathBuf,
    wake: mpsc::SyncSender<()>,
    stopped: Arc<AtomicBool>,
}

impl VocabOutbox {
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        let _ = self.wake.try_send(());
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn open(path: &std::path::Path) -> Result<Connection, VocabError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(path)
            .map_err(|_| failure("storageFailed"))?;
    }
    let db = Connection::open(path).map_err(|_| failure("storageFailed"))?;
    db.busy_timeout(Duration::from_secs(5))
        .map_err(|_| failure("storageFailed"))?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS captures (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0, error TEXT
    );",
    )
    .map_err(|_| failure("storageFailed"))?;
    Ok(db)
}

fn receipt(db: &Connection, id: &str) -> Result<Receipt, VocabError> {
    db.query_row(
        "SELECT state, error FROM captures WHERE id = ?1",
        [id],
        |row| {
            Ok(Receipt {
                request_id: id.to_owned(),
                state: row.get(0)?,
                error: row.get(1)?,
            })
        },
    )
    .map_err(|_| failure("storageFailed"))
}

fn enqueue(db: &mut Connection, capture: &ReadingCapture) -> Result<Receipt, VocabError> {
    let payload = serde_json::to_string(capture).map_err(|_| failure("invalidInput"))?;
    let fields = [
        (capture.request_id.as_str(), 64),
        (capture.selected_text.as_str(), 80),
        (capture.sentence.as_str(), 2000),
        (capture.title.as_str(), 300),
        (capture.heading.as_str(), 300),
        (capture.file_path.as_deref().unwrap_or_default(), 4096),
        (capture.sense_uid.as_deref().unwrap_or_default(), 200),
    ];
    if capture.request_id.is_empty()
        || capture.selected_text.trim().is_empty()
        || fields
            .iter()
            .any(|(value, max)| value.chars().count() > *max || value.contains('\0'))
        || payload.len() > MAX_BYTES
    {
        return Err(failure("invalidInput"));
    }
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| failure("storageFailed"))?;
    let existing: Option<(String, String)> = tx
        .query_row(
            "SELECT id, payload FROM captures WHERE id = ?1 OR (state != 'saved' AND json_remove(payload, '$.requestId') = json_remove(?2, '$.requestId')) ORDER BY CASE WHEN id=?1 THEN 0 ELSE 1 END LIMIT 1",
            params![capture.request_id, payload],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| failure("storageFailed"))?;
    let receipt_id;
    if let Some((id, existing)) = existing {
        if id == capture.request_id && existing != payload {
            return Err(failure("invalidInput"));
        }
        // An explicit retry keeps the exact payload and idempotency key.
        tx.execute(
            "UPDATE captures SET state='queued', due=0, error=NULL WHERE id=?1 AND state='error'",
            [&id],
        )
        .map_err(|_| failure("storageFailed"))?;
        receipt_id = id;
    } else {
        let pending: i64 = tx
            .query_row(
                "SELECT count(*) FROM captures WHERE state != 'saved'",
                [],
                |row| row.get(0),
            )
            .map_err(|_| failure("storageFailed"))?;
        if pending >= MAX_PENDING {
            return Err(failure("queueFull"));
        }
        tx.execute(
            "INSERT INTO captures (id, payload) VALUES (?1, ?2)",
            params![capture.request_id, payload],
        )
        .map_err(|_| failure("storageFailed"))?;
        receipt_id = capture.request_id.clone();
    }
    tx.commit().map_err(|_| failure("storageFailed"))?;
    receipt(db, &receipt_id)
}

fn deliver_one(
    db: &mut Connection,
    send: impl FnOnce(&ReadingCapture, bool) -> Result<serde_json::Value, VocabError>,
) -> Result<bool, VocabError> {
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| failure("storageFailed"))?;
    let job: Option<(String, String, i64)> = tx.query_row(
        "SELECT id, payload, attempts FROM captures WHERE state='queued' AND due<=?1 ORDER BY rowid LIMIT 1", [now()],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).optional().map_err(|_| failure("storageFailed"))?;
    let Some((id, payload, attempts)) = job else {
        return Ok(false);
    };
    tx.execute(
        "UPDATE captures SET due=?2, attempts=attempts+1 WHERE id=?1",
        params![id, now() + LEASE_SECONDS],
    )
    .map_err(|_| failure("storageFailed"))?;
    tx.commit().map_err(|_| failure("storageFailed"))?;
    let capture: ReadingCapture =
        serde_json::from_str(&payload).map_err(|_| failure("invalidInput"))?;
    let result = send(&capture, attempts == 0).and_then(|value| {
        if value
            .pointer("/capture/senseUid")
            .and_then(|uid| uid.as_str())
            .is_none_or(str::is_empty)
        {
            return Err(failure("unsupportedVersion"));
        }
        let acknowledged = value
            .get("capture")
            .cloned()
            .and_then(|v| serde_json::from_value::<ReadingCapture>(v).ok())
            .map(|mut v| {
                // Vocab also deduplicates identical sources across request IDs.
                v.request_id.clone_from(&capture.request_id);
                if capture.sense_uid.is_none() {
                    v.sense_uid = None;
                }
                v
            });
        if value
            .get("id")
            .and_then(|v| v.as_str())
            .is_some_and(|id| !id.is_empty())
            && acknowledged.as_ref() == Some(&capture)
        {
            Ok(())
        } else {
            Err(failure("invalidResponse"))
        }
    });
    match result {
        Ok(()) => {
            db.execute(
                "UPDATE captures SET state='saved', error=NULL WHERE id=?1",
                [&id],
            )
            .map_err(|_| failure("storageFailed"))?;
            db.execute("DELETE FROM captures WHERE state='saved' AND rowid NOT IN (SELECT rowid FROM captures WHERE state='saved' ORDER BY rowid DESC LIMIT 200)", []).map_err(|_| failure("storageFailed"))?;
        }
        Err(error) => {
            let retryable =
                ["notInstalled", "unavailable", "timeout"].contains(&error.code.as_str());
            let delay = (30 * 2_i64.pow(attempts.min(4) as u32)).min(300);
            db.execute(
                "UPDATE captures SET state=?2, error=?3, due=?4 WHERE id=?1",
                params![
                    id,
                    if retryable { "queued" } else { "error" },
                    error.code,
                    now() + delay
                ],
            )
            .map_err(|_| failure("storageFailed"))?;
        }
    }
    Ok(true)
}

pub fn start(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let directory = app.path().app_local_data_dir()?;
    let database = directory.join("vocab-outbox.sqlite3");
    let endpoint = app
        .path()
        .data_dir()?
        .join("com.polarbear.vocab")
        .join("reading");
    let (wake, receiver) = mpsc::sync_channel(1);
    let stopped = Arc::new(AtomicBool::new(false));
    app.manage(VocabOutbox {
        database: database.clone(),
        wake,
        stopped: stopped.clone(),
    });
    tauri::async_runtime::spawn_blocking(move || loop {
        if stopped.load(Ordering::Acquire) {
            break;
        }
        let result = std::fs::create_dir_all(&directory)
            .map_err(|_| failure("storageFailed"))
            .and_then(|_| open(&database));
        if let Ok(mut db) = result {
            for _ in 0..20 {
                if stopped.load(Ordering::Acquire) {
                    break;
                }
                let result = deliver_one(&mut db, |capture, launch| {
                    let mut bytes = serde_json::to_vec(&serde_json::json!({"version":1,"operation":{"method":"save","capture":capture}})).map_err(|_| failure("invalidInput"))?;
                    bytes.push(b'\n');
                    exchange(&endpoint, &bytes, launch)
                });
                if !matches!(result, Ok(true)) {
                    break;
                }
            }
        }
        if matches!(
            receiver.recv_timeout(Duration::from_secs(POLL_SECONDS)),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ) {
            break;
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn enqueue_vocab_capture(
    state: tauri::State<'_, VocabOutbox>,
    capture: ReadingCapture,
) -> Result<Receipt, VocabError> {
    let database = state.database.clone();
    let wake = state.wake.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = database.parent() {
            std::fs::create_dir_all(parent).map_err(|_| failure("storageFailed"))?;
        }
        let result = enqueue(&mut open(&database)?, &capture)?;
        let _ = wake.try_send(());
        Ok(result)
    })
    .await
    .map_err(|_| failure("storageFailed"))?
}

#[tauri::command]
pub async fn vocab_capture_status(
    state: tauri::State<'_, VocabOutbox>,
    request_id: String,
) -> Result<Receipt, VocabError> {
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || receipt(&open(&database)?, &request_id))
        .await
        .map_err(|_| failure("storageFailed"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn capture() -> ReadingCapture {
        ReadingCapture {
            request_id: "test".into(),
            selected_text: "OEMS".into(),
            sense_uid: None,
            sentence: "source".into(),
            title: "Article".into(),
            file_path: None,
            heading: String::new(),
            line: None,
        }
    }
    #[test]
    fn persists_offline_captures_and_requires_exact_acknowledgement() {
        let path =
            std::env::temp_dir().join(format!("pb-outbox-{}-{}.sqlite", std::process::id(), now()));
        let mut db = open(&path).unwrap();
        let item = capture();
        assert_eq!(enqueue(&mut db, &item).unwrap().state, "queued");
        assert_eq!(enqueue(&mut db, &item).unwrap().state, "queued");
        let mut duplicate = item.clone();
        duplicate.request_id = "reselected".into();
        assert_eq!(enqueue(&mut db, &duplicate).unwrap().request_id, "test");
        let mut changed = item.clone();
        changed.selected_text = "changed".into();
        assert!(enqueue(&mut db, &changed).is_err());
        deliver_one(&mut db, |_, launch| {
            assert!(launch);
            let mut concurrent = open(&path).unwrap();
            assert!(!deliver_one(&mut concurrent, |_, _| panic!(
                "A leased job must have one sender"
            ))
            .unwrap());
            Err(failure("unavailable"))
        })
        .unwrap();
        drop(db);
        let mut db = open(&path).unwrap();
        assert_eq!(receipt(&db, "test").unwrap().state, "queued");
        assert!(!deliver_one(&mut db, |_, _| panic!(
            "Backoff must prevent early delivery"
        ))
        .unwrap());
        db.execute("UPDATE captures SET due=0", []).unwrap();
        deliver_one(&mut db, |_, launch| {
            assert!(!launch);
            Ok(serde_json::json!({"id":"ack","capture":changed}))
        })
        .unwrap();
        assert_eq!(receipt(&db, "test").unwrap().state, "error");
        enqueue(&mut db, &item).unwrap();
        deliver_one(&mut db, |_, _| {
            let mut resolved = duplicate.clone();
            resolved.sense_uid = Some("resolved-by-vocab".into());
            Ok(serde_json::json!({"id":"ack","capture":resolved}))
        })
        .unwrap();
        assert_eq!(receipt(&db, "test").unwrap().state, "saved");
        assert!(!deliver_one(&mut db, |_, _| panic!(
            "Acknowledged captures must not be sent again"
        ))
        .unwrap());
        duplicate.request_id = "explicit-recapture".into();
        assert_eq!(enqueue(&mut db, &duplicate).unwrap().state, "queued");
        assert_eq!(receipt(&db, "explicit-recapture").unwrap().state, "queued");
        drop(db);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_invalid_payloads_and_bounds_pending_storage() {
        let path = std::env::temp_dir().join(format!(
            "pb-outbox-limit-{}-{}.sqlite",
            std::process::id(),
            now()
        ));
        let mut db = open(&path).unwrap();
        let mut invalid = capture();
        invalid.sentence = "x".repeat(2001);
        assert_eq!(enqueue(&mut db, &invalid).unwrap_err().code, "invalidInput");
        let tx = db.transaction().unwrap();
        for id in 0..MAX_PENDING {
            let mut item = capture();
            item.request_id = id.to_string();
            item.selected_text = format!("word{id}");
            tx.execute(
                "INSERT INTO captures (id, payload) VALUES (?1, ?2)",
                params![item.request_id, serde_json::to_string(&item).unwrap()],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        assert_eq!(enqueue(&mut db, &capture()).unwrap_err().code, "queueFull");
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
}
