use super::RepositoryBindingDto;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

#[derive(Clone)]
pub(super) struct LocalFileCacheEntry {
    pub relative_path: String,
    pub size: i64,
    pub modified_ns: i64,
    pub digest: String,
}

pub(super) fn load_bindings(
    database_path: &Path,
    legacy_json_path: &Path,
) -> Result<BTreeMap<String, RepositoryBindingDto>, String> {
    let mut connection = open(database_path)?;
    migrate_legacy_bindings(&mut connection, legacy_json_path)?;
    load_bindings_from_connection(&connection)
}

pub(super) fn replace_bindings(
    database_path: &Path,
    bindings: &BTreeMap<String, RepositoryBindingDto>,
) -> Result<(), String> {
    let mut connection = open(database_path)?;
    let transaction = connection.transaction().map_err(to_string)?;
    replace_bindings_in_transaction(&transaction, bindings)?;
    transaction.commit().map_err(to_string)
}

pub(super) fn read_local_file_cache(
    database_path: &Path,
    workspace_ref: &str,
) -> Result<BTreeMap<String, LocalFileCacheEntry>, String> {
    let connection = open(database_path)?;
    let mut statement = connection
        .prepare(
            "SELECT relative_path, local_size, local_modified_ns, local_digest
             FROM sync_file_state
             WHERE workspace_ref = ?1 AND local_digest IS NOT NULL",
        )
        .map_err(to_string)?;
    let entries = statement
        .query_map(params![workspace_ref], |row| {
            let relative_path = row.get::<_, String>(0)?;
            Ok((
                relative_path.clone(),
                LocalFileCacheEntry {
                    relative_path,
                    size: row.get(1)?,
                    modified_ns: row.get(2)?,
                    digest: row.get(3)?,
                },
            ))
        })
        .map_err(to_string)?
        .collect::<Result<BTreeMap<_, _>, _>>()
        .map_err(to_string)?;
    Ok(entries)
}

pub(super) fn replace_local_file_cache(
    database_path: &Path,
    workspace_ref: &str,
    entries: &[LocalFileCacheEntry],
) -> Result<(), String> {
    let mut connection = open(database_path)?;
    let transaction = connection.transaction().map_err(to_string)?;
    transaction
        .execute(
            "UPDATE sync_file_state
             SET local_size = NULL, local_modified_ns = NULL, local_digest = NULL
             WHERE workspace_ref = ?1",
            params![workspace_ref],
        )
        .map_err(to_string)?;
    for entry in entries {
        transaction
            .execute(
                "INSERT INTO sync_file_state (
                    workspace_ref, relative_path, local_size, local_modified_ns,
                    local_digest, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
                 ON CONFLICT(workspace_ref, relative_path) DO UPDATE SET
                    local_size = excluded.local_size,
                    local_modified_ns = excluded.local_modified_ns,
                    local_digest = excluded.local_digest,
                    updated_at = excluded.updated_at",
                params![
                    workspace_ref,
                    entry.relative_path,
                    entry.size,
                    entry.modified_ns,
                    entry.digest
                ],
            )
            .map_err(to_string)?;
    }
    transaction
        .execute(
            "DELETE FROM sync_file_state
             WHERE workspace_ref = ?1
               AND local_digest IS NULL
               AND remote_digest IS NULL",
            params![workspace_ref],
        )
        .map_err(to_string)?;
    transaction.commit().map_err(to_string)
}

pub(super) fn replace_outbox(
    database_path: &Path,
    workspace_ref: &str,
    operations: &[(String, String)],
) -> Result<(), String> {
    let mut connection = open(database_path)?;
    let transaction = connection.transaction().map_err(to_string)?;
    transaction
        .execute(
            "DELETE FROM sync_outbox WHERE workspace_ref = ?1",
            params![workspace_ref],
        )
        .map_err(to_string)?;
    for (relative_path, operation) in operations {
        transaction
            .execute(
                "INSERT INTO sync_outbox (
                    workspace_ref, relative_path, operation, queued_at
                 ) VALUES (?1, ?2, ?3, unixepoch())",
                params![workspace_ref, relative_path, operation],
            )
            .map_err(to_string)?;
    }
    transaction.commit().map_err(to_string)
}

pub(super) fn queue_outbox_path(
    database_path: &Path,
    workspace_ref: &str,
    relative_path: &str,
    operation: &str,
) -> Result<(), String> {
    let connection = open(database_path)?;
    connection
        .execute(
            "INSERT INTO sync_outbox (
                workspace_ref, relative_path, operation, queued_at
             ) VALUES (?1, ?2, ?3, unixepoch())
             ON CONFLICT(workspace_ref, relative_path) DO UPDATE SET
                operation = excluded.operation,
                queued_at = excluded.queued_at",
            params![workspace_ref, relative_path, operation],
        )
        .map_err(to_string)?;
    Ok(())
}

pub(super) fn read_outbox(
    database_path: &Path,
    workspace_ref: &str,
) -> Result<BTreeMap<String, String>, String> {
    let connection = open(database_path)?;
    let mut statement = connection
        .prepare(
            "SELECT relative_path, operation
             FROM sync_outbox
             WHERE workspace_ref = ?1",
        )
        .map_err(to_string)?;
    let operations = statement
        .query_map(params![workspace_ref], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(to_string)?
        .collect::<Result<BTreeMap<_, _>, _>>()
        .map_err(to_string)?;
    Ok(operations)
}

pub(super) fn clear_outbox(database_path: &Path, workspace_ref: &str) -> Result<(), String> {
    let connection = open(database_path)?;
    connection
        .execute(
            "DELETE FROM sync_outbox WHERE workspace_ref = ?1",
            params![workspace_ref],
        )
        .map_err(to_string)?;
    Ok(())
}

pub(super) fn begin_sync_run(
    database_path: &Path,
    workspace_ref: &str,
    operation: &str,
) -> Result<i64, String> {
    let mut connection = open(database_path)?;
    let transaction = connection.transaction().map_err(to_string)?;
    transaction
        .execute(
            "UPDATE sync_run
             SET status = 'interrupted', finished_at = unixepoch()
             WHERE status = 'running'",
            [],
        )
        .map_err(to_string)?;
    transaction
        .execute(
            "INSERT INTO sync_run (workspace_ref, operation, status, started_at)
             VALUES (?1, ?2, 'running', unixepoch())",
            params![workspace_ref, operation],
        )
        .map_err(to_string)?;
    let run_id = transaction.last_insert_rowid();
    transaction
        .execute(
            "INSERT INTO sync_runtime (slot, active_run_id)
             VALUES (1, ?1)
             ON CONFLICT(slot) DO UPDATE SET active_run_id = excluded.active_run_id",
            params![run_id],
        )
        .map_err(to_string)?;
    transaction.commit().map_err(to_string)?;
    Ok(run_id)
}

pub(super) fn append_active_run_event(
    database_path: &Path,
    phase: &str,
    message: &str,
    current: Option<usize>,
    total: Option<usize>,
) -> Result<(), String> {
    let connection = open_existing(database_path)?;
    let active_run_id = connection
        .query_row(
            "SELECT active_run_id FROM sync_runtime WHERE slot = 1",
            [],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(to_string)?
        .flatten();
    let Some(run_id) = active_run_id else {
        return Ok(());
    };
    connection
        .execute(
            "INSERT INTO sync_run_event (
                run_id, phase, message, current_value, total_value, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())",
            params![
                run_id,
                phase,
                message,
                current.map(|value| value as i64),
                total.map(|value| value as i64)
            ],
        )
        .map_err(to_string)?;
    Ok(())
}

pub(super) fn finish_sync_run(
    database_path: &Path,
    run_id: i64,
    status: &str,
    error: Option<&str>,
) -> Result<(), String> {
    let mut connection = open(database_path)?;
    let transaction = connection.transaction().map_err(to_string)?;
    transaction
        .execute(
            "UPDATE sync_run
             SET status = ?2, finished_at = unixepoch(), error = ?3
             WHERE id = ?1",
            params![run_id, status, error],
        )
        .map_err(to_string)?;
    transaction
        .execute(
            "UPDATE sync_runtime SET active_run_id = NULL
             WHERE slot = 1 AND active_run_id = ?1",
            params![run_id],
        )
        .map_err(to_string)?;
    transaction.commit().map_err(to_string)
}

fn open(database_path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(database_path).map_err(to_string)?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;

             CREATE TABLE IF NOT EXISTS sync_meta (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );

             CREATE TABLE IF NOT EXISTS sync_workspace (
               workspace_ref TEXT PRIMARY KEY,
               provider TEXT NOT NULL,
               owner TEXT NOT NULL,
               repo TEXT NOT NULL,
               branch TEXT NOT NULL,
               remote_path TEXT NOT NULL,
               base_url TEXT,
               last_sync_commit_sha TEXT,
               last_sync_at INTEGER,
               has_synced INTEGER NOT NULL DEFAULT 0,
               updated_at INTEGER NOT NULL DEFAULT (unixepoch())
             );

             CREATE TABLE IF NOT EXISTS sync_file_state (
               workspace_ref TEXT NOT NULL,
               relative_path TEXT NOT NULL,
               local_size INTEGER,
               local_modified_ns INTEGER,
               local_digest TEXT,
               remote_digest TEXT,
               updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
               PRIMARY KEY (workspace_ref, relative_path),
               FOREIGN KEY (workspace_ref) REFERENCES sync_workspace(workspace_ref)
                 ON DELETE CASCADE
             );

             CREATE TABLE IF NOT EXISTS sync_outbox (
               workspace_ref TEXT NOT NULL,
               relative_path TEXT NOT NULL,
               operation TEXT NOT NULL,
               queued_at INTEGER NOT NULL,
               PRIMARY KEY (workspace_ref, relative_path),
               FOREIGN KEY (workspace_ref) REFERENCES sync_workspace(workspace_ref)
                 ON DELETE CASCADE
             );

             CREATE TABLE IF NOT EXISTS sync_run (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               workspace_ref TEXT NOT NULL,
               operation TEXT NOT NULL,
               status TEXT NOT NULL,
               started_at INTEGER NOT NULL,
               finished_at INTEGER,
               error TEXT
             );

             CREATE TABLE IF NOT EXISTS sync_run_event (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               run_id INTEGER NOT NULL,
               phase TEXT NOT NULL,
               message TEXT NOT NULL,
               current_value INTEGER,
               total_value INTEGER,
               created_at INTEGER NOT NULL,
               FOREIGN KEY (run_id) REFERENCES sync_run(id) ON DELETE CASCADE
             );

             CREATE TABLE IF NOT EXISTS sync_runtime (
               slot INTEGER PRIMARY KEY CHECK (slot = 1),
               active_run_id INTEGER,
               FOREIGN KEY (active_run_id) REFERENCES sync_run(id) ON DELETE SET NULL
             );

             CREATE INDEX IF NOT EXISTS idx_sync_file_local_digest
               ON sync_file_state(workspace_ref, local_digest);
             CREATE INDEX IF NOT EXISTS idx_sync_outbox_workspace
               ON sync_outbox(workspace_ref, queued_at);
             CREATE INDEX IF NOT EXISTS idx_sync_event_run
               ON sync_run_event(run_id, id);",
        )
        .map_err(to_string)?;
    Ok(connection)
}

fn open_existing(database_path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(database_path).map_err(to_string)?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(to_string)?;
    Ok(connection)
}

fn migrate_legacy_bindings(
    connection: &mut Connection,
    legacy_json_path: &Path,
) -> Result<(), String> {
    let migration_complete = connection
        .query_row(
            "SELECT value FROM sync_meta WHERE key = 'legacy_bindings_imported'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(to_string)?
        .is_some();
    if migration_complete {
        return Ok(());
    }

    let legacy_bindings = if legacy_json_path.exists() {
        let content = fs::read_to_string(legacy_json_path).map_err(to_string)?;
        serde_json::from_str::<BTreeMap<String, RepositoryBindingDto>>(&content)
            .map_err(to_string)?
    } else {
        BTreeMap::new()
    };
    let transaction = connection.transaction().map_err(to_string)?;
    if !legacy_bindings.is_empty() {
        replace_bindings_in_transaction(&transaction, &legacy_bindings)?;
    }
    transaction
        .execute(
            "INSERT INTO sync_meta (key, value)
             VALUES ('legacy_bindings_imported', '1')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [],
        )
        .map_err(to_string)?;
    transaction.commit().map_err(to_string)?;

    if legacy_json_path.exists() {
        let backup_path = legacy_json_path.with_extension("json.migrated");
        if !backup_path.exists() {
            let _ = fs::rename(legacy_json_path, backup_path);
        }
    }
    Ok(())
}

fn load_bindings_from_connection(
    connection: &Connection,
) -> Result<BTreeMap<String, RepositoryBindingDto>, String> {
    let mut statement = connection
        .prepare(
            "SELECT workspace_ref, provider, owner, repo, branch, remote_path,
                    base_url, last_sync_commit_sha, last_sync_at, has_synced
             FROM sync_workspace",
        )
        .map_err(to_string)?;
    let bindings = statement
        .query_map([], |row| {
            Ok(RepositoryBindingDto {
                workspace_ref: row.get(0)?,
                provider: row.get(1)?,
                owner: row.get(2)?,
                repo: row.get(3)?,
                branch: row.get(4)?,
                remote_path: row.get(5)?,
                base_url: row.get(6)?,
                last_sync_commit_sha: row.get(7)?,
                last_sync_at: row.get(8)?,
                has_synced: row.get::<_, i64>(9)? != 0,
                manifest: BTreeMap::new(),
            })
        })
        .map_err(to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;

    let mut result = BTreeMap::new();
    for mut binding in bindings {
        let mut manifest_statement = connection
            .prepare(
                "SELECT relative_path, remote_digest
                 FROM sync_file_state
                 WHERE workspace_ref = ?1 AND remote_digest IS NOT NULL",
            )
            .map_err(to_string)?;
        binding.manifest = manifest_statement
            .query_map(params![binding.workspace_ref], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(to_string)?
            .collect::<Result<BTreeMap<_, _>, _>>()
            .map_err(to_string)?;
        result.insert(binding.workspace_ref.clone(), binding);
    }
    Ok(result)
}

fn replace_bindings_in_transaction(
    transaction: &Transaction<'_>,
    bindings: &BTreeMap<String, RepositoryBindingDto>,
) -> Result<(), String> {
    let existing_workspace_refs = {
        let mut statement = transaction
            .prepare("SELECT workspace_ref FROM sync_workspace")
            .map_err(to_string)?;
        let workspace_refs = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(to_string)?
            .collect::<Result<BTreeSet<_>, _>>()
            .map_err(to_string)?;
        workspace_refs
    };
    for workspace_ref in existing_workspace_refs {
        if !bindings.contains_key(&workspace_ref) {
            transaction
                .execute(
                    "DELETE FROM sync_workspace WHERE workspace_ref = ?1",
                    params![workspace_ref],
                )
                .map_err(to_string)?;
        }
    }

    for binding in bindings.values() {
        transaction
            .execute(
                "INSERT INTO sync_workspace (
                    workspace_ref, provider, owner, repo, branch, remote_path,
                    base_url, last_sync_commit_sha, last_sync_at, has_synced, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, unixepoch())
                 ON CONFLICT(workspace_ref) DO UPDATE SET
                    provider = excluded.provider,
                    owner = excluded.owner,
                    repo = excluded.repo,
                    branch = excluded.branch,
                    remote_path = excluded.remote_path,
                    base_url = excluded.base_url,
                    last_sync_commit_sha = excluded.last_sync_commit_sha,
                    last_sync_at = excluded.last_sync_at,
                    has_synced = excluded.has_synced,
                    updated_at = excluded.updated_at",
                params![
                    binding.workspace_ref,
                    binding.provider,
                    binding.owner,
                    binding.repo,
                    binding.branch,
                    binding.remote_path,
                    binding.base_url,
                    binding.last_sync_commit_sha,
                    binding.last_sync_at,
                    if binding.has_synced { 1_i64 } else { 0_i64 }
                ],
            )
            .map_err(to_string)?;
        transaction
            .execute(
                "UPDATE sync_file_state SET remote_digest = NULL
                 WHERE workspace_ref = ?1",
                params![binding.workspace_ref],
            )
            .map_err(to_string)?;
        for (relative_path, remote_digest) in &binding.manifest {
            transaction
                .execute(
                    "INSERT INTO sync_file_state (
                        workspace_ref, relative_path, remote_digest, updated_at
                     ) VALUES (?1, ?2, ?3, unixepoch())
                     ON CONFLICT(workspace_ref, relative_path) DO UPDATE SET
                        remote_digest = excluded.remote_digest,
                        updated_at = excluded.updated_at",
                    params![binding.workspace_ref, relative_path, remote_digest],
                )
                .map_err(to_string)?;
        }
        transaction
            .execute(
                "DELETE FROM sync_file_state
                 WHERE workspace_ref = ?1
                   AND local_digest IS NULL
                   AND remote_digest IS NULL",
                params![binding.workspace_ref],
            )
            .map_err(to_string)?;
    }
    Ok(())
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
