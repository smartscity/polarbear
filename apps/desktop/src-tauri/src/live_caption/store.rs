use super::{CaptionError, CaptionResult};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub place: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub source: String,
    pub time_zone: String,
    pub status: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: i64,
    pub session_id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub english: String,
    pub chinese: Option<String>,
    pub translation_status: String,
}

#[derive(Debug, Serialize)]
pub struct Job {
    pub id: i64,
    pub lease: String,
    pub english: String,
}

pub struct CaptionStore(Connection);

fn storage(error: impl std::fmt::Display) -> CaptionError {
    // Do not expose transcripts, SQL parameters or native paths in IPC errors.
    eprintln!(
        "Live Caption storage error: {}",
        std::any::type_name_of_val(&error)
    );
    CaptionError::new("storageFailed")
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_millis() as i64)
        .unwrap_or_default()
}

pub fn validate_time_zone(zone: &str) -> CaptionResult<()> {
    if zone.len() > 100
        || !zone
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_/-+".contains(c))
    {
        return Err(CaptionError::new("invalidRequest"));
    }
    Ok(())
}

impl CaptionStore {
    #[cfg(test)]
    #[allow(clippy::unwrap_used)]
    pub(super) fn memory() -> Self {
        Self::initialize(Connection::open_in_memory().unwrap()).unwrap()
    }

    pub fn open(path: &Path) -> CaptionResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(storage)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                    .map_err(storage)?;
            }
        }
        let connection = Connection::open(path).map_err(storage)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .map_err(storage)?;
        }
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(storage)?;
        Self::initialize(connection)
    }

    fn initialize(connection: Connection) -> CaptionResult<Self> {
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(storage)?;
        if version > 2 {
            return Err(CaptionError::new("historyVersion"));
        }
        connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, place TEXT NOT NULL DEFAULT '',
                started_at INTEGER NOT NULL, ended_at INTEGER, source TEXT NOT NULL,
                status TEXT NOT NULL, model TEXT NOT NULL, time_zone TEXT NOT NULL DEFAULT 'UTC');
            CREATE TABLE IF NOT EXISTS segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                sequence INTEGER NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
                english TEXT NOT NULL, chinese TEXT, translation_status TEXT NOT NULL DEFAULT 'pending',
                lease TEXT, lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
                UNIQUE(session_id, sequence), CHECK(end_ms >= start_ms), CHECK(length(english)>0));
            CREATE INDEX IF NOT EXISTS caption_pending ON segments(translation_status, lease_until);
            CREATE TABLE IF NOT EXISTS intervals (
                id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                at_ms INTEGER NOT NULL, kind TEXT NOT NULL);
            COMMIT;").map_err(storage)?;
        if version == 1 {
            connection.execute_batch("BEGIN IMMEDIATE; ALTER TABLE sessions ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC'; PRAGMA user_version=2; COMMIT;").map_err(storage)?;
        } else {
            connection
                .pragma_update(None, "user_version", 2)
                .map_err(storage)?;
        }
        Ok(Self(connection))
    }

    pub fn recover(&self) -> CaptionResult<()> {
        self.0
            .execute(
                "UPDATE sessions SET status='interrupted', ended_at=? WHERE ended_at IS NULL",
                [now()],
            )
            .map_err(storage)?;
        self.0
            .execute(
                "UPDATE segments SET lease=NULL, lease_until=NULL WHERE chinese IS NULL",
                [],
            )
            .map_err(storage)?;
        Ok(())
    }

    pub fn create(&self, source: &str) -> CaptionResult<String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.0.execute("INSERT INTO sessions(id,title,started_at,source,status,model) VALUES(?, '', ?, ?, 'starting', 'whisper-base.en-q5_1')", params![id, now(), source]).map_err(storage)?;
        Ok(id)
    }

    pub fn set_time_zone(&self, id: &str, zone: &str) -> CaptionResult<()> {
        validate_time_zone(zone)?;
        self.0
            .execute(
                "UPDATE sessions SET time_zone=? WHERE id=?",
                params![zone, id],
            )
            .map_err(storage)?;
        Ok(())
    }

    pub fn state(&self, id: &str, status: &str, elapsed: i64, ended: bool) -> CaptionResult<()> {
        let tx = self.0.unchecked_transaction().map_err(storage)?;
        tx.execute(
            "UPDATE sessions SET status=?, ended_at=? WHERE id=?",
            params![status, ended.then(now), id],
        )
        .map_err(storage)?;
        tx.execute(
            "INSERT INTO intervals(session_id,at_ms,kind) VALUES(?,?,?)",
            params![id, elapsed, status],
        )
        .map_err(storage)?;
        tx.commit().map_err(storage)
    }

    pub fn append(
        &self,
        session: &str,
        sequence: i64,
        start: i64,
        end: i64,
        english: &str,
    ) -> CaptionResult<()> {
        if english.trim().is_empty() || english.len() > 16384 || start < 0 || end < start {
            return Err(CaptionError::new("engineProtocol"));
        }
        // The durable translation job is the segment itself: insertion is atomic and idempotent.
        self.0.execute("INSERT OR IGNORE INTO segments(session_id,sequence,start_ms,end_ms,english) VALUES(?,?,?,?,?)",
            params![session, sequence, start, end, english.trim()]).map_err(storage)?;
        Ok(())
    }

    pub fn list(&self, query: &str, offset: u32) -> CaptionResult<Vec<Session>> {
        let mut statement = self.0.prepare("SELECT s.id,s.title,s.place,s.started_at,s.ended_at,s.source,s.status,
            (SELECT count(*) FROM segments WHERE session_id=s.id),s.time_zone FROM sessions s
            WHERE instr(lower(s.title || ' ' || s.place || ' ' || date(s.started_at/1000,'unixepoch')),lower(?1))>0 OR EXISTS
            (SELECT 1 FROM segments WHERE session_id=s.id AND instr(lower(english || ' ' || coalesce(chinese,'')),lower(?1))>0)
            ORDER BY started_at DESC LIMIT 50 OFFSET ?2").map_err(storage)?;
        let rows = statement
            .query_map(params![query, offset], |row| {
                Ok(Session {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    place: row.get(2)?,
                    started_at: row.get(3)?,
                    ended_at: row.get(4)?,
                    source: row.get(5)?,
                    status: row.get(6)?,
                    count: row.get(7)?,
                    time_zone: row.get(8)?,
                })
            })
            .map_err(storage)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(storage)
    }

    pub fn segments(&self, id: &str, after: i64, limit: usize) -> CaptionResult<Vec<Segment>> {
        let mut statement = self
            .0
            .prepare(
                "SELECT id,session_id,start_ms,end_ms,english,chinese,translation_status
            FROM segments WHERE session_id=? AND id>? ORDER BY id LIMIT ?",
            )
            .map_err(storage)?;
        let rows = statement
            .query_map(params![id, after, limit.min(500) as i64], |row| {
                Ok(Segment {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    start_ms: row.get(2)?,
                    end_ms: row.get(3)?,
                    english: row.get(4)?,
                    chinese: row.get(5)?,
                    translation_status: row.get(6)?,
                })
            })
            .map_err(storage)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(storage)
    }

    pub fn tail(&self, id: &str) -> CaptionResult<Vec<Segment>> {
        let after: i64 = self.0.query_row("SELECT coalesce((SELECT id FROM segments WHERE session_id=? ORDER BY id DESC LIMIT 1 OFFSET 200),0)", [id], |row|row.get(0)).map_err(storage)?;
        self.segments(id, after, 200)
    }

    pub fn claim(&self) -> CaptionResult<Option<Job>> {
        let tx = self.0.unchecked_transaction().map_err(storage)?;
        let next = {
            let mut statement = tx
                .prepare(
                    "SELECT id,english FROM segments WHERE chinese IS NULL AND attempts<3
                AND (lease_until IS NULL OR lease_until<?) ORDER BY id LIMIT 1",
                )
                .map_err(storage)?;
            let mut rows = statement.query([now()]).map_err(storage)?;
            match rows.next().map_err(storage)? {
                Some(row) => Some((
                    row.get::<_, i64>(0).map_err(storage)?,
                    row.get::<_, String>(1).map_err(storage)?,
                )),
                None => None,
            }
        };
        let result = if let Some((id, english)) = next {
            let lease = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "UPDATE segments SET lease=?, lease_until=?, attempts=attempts+1 WHERE id=?",
                params![lease, now() + 120_000, id],
            )
            .map_err(storage)?;
            Some(Job { id, lease, english })
        } else {
            None
        };
        tx.commit().map_err(storage)?;
        Ok(result)
    }

    pub fn complete(&self, id: i64, lease: &str, chinese: Option<&str>) -> CaptionResult<()> {
        if chinese.is_some_and(|text| text.trim().is_empty() || text.len() > 32768) {
            return Err(CaptionError::new("invalidRequest"));
        }
        self.0
            .execute(
                "UPDATE segments SET chinese=?, translation_status=?, lease=NULL, lease_until=NULL
            WHERE id=? AND lease=? AND lease_until>=?",
                params![
                    chinese,
                    if chinese.is_some() { "ready" } else { "failed" },
                    id,
                    lease,
                    now()
                ],
            )
            .map_err(storage)?;
        Ok(())
    }

    pub fn retry(&self, session: &str) -> CaptionResult<()> {
        self.0.execute("UPDATE segments SET attempts=0, translation_status='pending' WHERE session_id=? AND chinese IS NULL AND lease IS NULL", [session]).map_err(storage)?;
        Ok(())
    }

    pub fn rename(&self, id: &str, title: &str, place: &str) -> CaptionResult<()> {
        if title.len() > 512 || place.len() > 512 {
            return Err(CaptionError::new("invalidRequest"));
        }
        self.0
            .execute(
                "UPDATE sessions SET title=?,place=? WHERE id=?",
                params![title.trim(), place.trim(), id],
            )
            .map_err(storage)?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> CaptionResult<()> {
        self.0
            .execute("DELETE FROM sessions WHERE id=?", [id])
            .map_err(storage)?;
        Ok(())
    }

    #[cfg(test)]
    pub fn pending(&self) -> CaptionResult<i64> {
        self.0
            .query_row(
                "SELECT count(*) FROM segments WHERE chinese IS NULL AND attempts<3",
                [],
                |r| r.get(0),
            )
            .map_err(storage)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    fn database() -> CaptionStore {
        CaptionStore::initialize(Connection::open_in_memory().unwrap()).unwrap()
    }
    #[test]
    fn finalized_segments_are_idempotent_and_translation_is_leased() {
        let db = database();
        let id = db.create("system").unwrap();
        db.append(&id, 1, 0, 1000, "Hello world").unwrap();
        db.append(&id, 1, 0, 1000, "Hello world").unwrap();
        assert_eq!(db.list("", 0).unwrap()[0].count, 1);
        let job = db.claim().unwrap().unwrap();
        assert!(db.claim().unwrap().is_none());
        db.complete(job.id, "stale", Some("translation")).unwrap();
        assert_eq!(db.pending().unwrap(), 1);
        db.complete(job.id, &job.lease, Some("translation"))
            .unwrap();
        assert_eq!(db.pending().unwrap(), 0);
        assert_eq!(
            db.segments(&id, 0, 500).unwrap()[0].chinese.as_deref(),
            Some("translation")
        );
    }
    #[test]
    fn recovery_keeps_text_and_never_restarts_capture() {
        let db = database();
        let id = db.create("microphone").unwrap();
        db.append(&id, 1, 0, 1000, "Keep this").unwrap();
        db.claim().unwrap();
        db.recover().unwrap();
        assert_eq!(db.list("Keep", 0).unwrap()[0].status, "interrupted");
        assert!(db.claim().unwrap().is_some());
        db.delete(&id).unwrap();
        assert_eq!(db.pending().unwrap(), 0);
    }
    #[test]
    fn invalid_segments_do_not_create_jobs() {
        let db = database();
        let id = db.create("system").unwrap();
        assert!(db.append(&id, 1, 100, 10, "text").is_err());
        assert!(db.append(&id, 1, 0, 10, " ").is_err());
        assert_eq!(db.pending().unwrap(), 0);
    }

    #[test]
    fn storage_failure_does_not_acknowledge_or_overwrite_a_segment() {
        let db = database();
        let id = db.create("system").unwrap();
        db.append(&id, 1, 0, 1000, "Committed original").unwrap();
        db.0.execute_batch("PRAGMA query_only=ON;").unwrap();
        assert!(db.append(&id, 2, 1000, 2000, "Unsaved").is_err());
        let rows = db.segments(&id, 0, 500).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].english, "Committed original");
    }

    #[test]
    fn paginated_history_and_live_tail_do_not_truncate_copy_source() {
        let db = database();
        let id = db.create("system").unwrap();
        for sequence in 1..=450 {
            db.append(
                &id,
                sequence,
                sequence * 1000,
                sequence * 1000 + 500,
                "Saved segment",
            )
            .unwrap();
        }
        assert_eq!(db.tail(&id).unwrap().len(), 200);
        assert_eq!(db.tail(&id).unwrap()[0].start_ms, 251000);
        assert_eq!(db.segments(&id, 0, 500).unwrap().len(), 450);
        assert_eq!(db.list("Saved", 0).unwrap()[0].count, 450);
    }

    #[test]
    fn reopened_history_retains_both_languages_without_recording() {
        let directory =
            std::env::temp_dir().join(format!("polarbear-caption-test-{}", uuid::Uuid::new_v4()));
        let path = directory.join("history.sqlite3");
        let id;
        {
            let db = CaptionStore::open(&path).unwrap();
            id = db.create("system").unwrap();
            db.append(&id, 1, 0, 1000, "Hello").unwrap();
            let job = db.claim().unwrap().unwrap();
            db.complete(job.id, &job.lease, Some("Translation"))
                .unwrap();
        }
        {
            let db = CaptionStore::open(&path).unwrap();
            db.recover().unwrap();
            assert_eq!(db.list("", 0).unwrap()[0].status, "interrupted");
            assert_eq!(
                db.segments(&id, 0, 200).unwrap()[0].chinese.as_deref(),
                Some("Translation")
            );
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn timezone_migration_is_repeatable_and_preserves_existing_sessions() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE sessions (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, place TEXT NOT NULL DEFAULT '',
            started_at INTEGER NOT NULL, ended_at INTEGER, source TEXT NOT NULL,
            status TEXT NOT NULL, model TEXT NOT NULL);
            INSERT INTO sessions VALUES('legacy', 'Meeting', '', 1000, NULL, 'system', 'paused', 'model');
            PRAGMA user_version=1;").unwrap();
        let db = CaptionStore::initialize(connection).unwrap();
        assert_eq!(db.list("", 0).unwrap()[0].time_zone, "UTC");
        db.set_time_zone("legacy", "Asia/Singapore").unwrap();
        let reopened = CaptionStore::initialize(db.0).unwrap();
        assert_eq!(reopened.list("", 0).unwrap()[0].time_zone, "Asia/Singapore");
        assert!(validate_time_zone("bad\nzone").is_err());
        assert!(validate_time_zone(&"x".repeat(101)).is_err());
    }
}
