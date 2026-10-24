use super::store::cloud_sync_database_path;
use crate::{cloud_sync_store, ipc_contracts};
use serde::Serialize;
use tauri::Emitter;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct RepositorySyncProgressDto {
    pub(super) phase: String,
    pub(super) message: String,
    pub(super) current: Option<usize>,
    pub(super) total: Option<usize>,
}

pub(super) fn emit_repository_sync_progress(
    app: &tauri::AppHandle,
    phase: &str,
    message: impl Into<String>,
    current: Option<usize>,
    total: Option<usize>,
) {
    let message = message.into();
    let _ = app.emit(
        ipc_contracts::REPOSITORY_SYNC_PROGRESS_EVENT,
        RepositorySyncProgressDto {
            phase: phase.to_owned(),
            message: message.clone(),
            current,
            total,
        },
    );
    if let Ok(database_path) = cloud_sync_database_path(app) {
        let _ = cloud_sync_store::append_active_run_event(
            &database_path,
            phase,
            &message,
            current,
            total,
        );
    }
}
