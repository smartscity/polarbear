use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, sync::Mutex};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderEntry {
    collection: String,
    path: String,
    imported_at: f64,
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct ImportResult {
    pub entries: Vec<ReaderEntry>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct OpenedDocument {
    pub id: u64,
    #[serde(flatten)]
    pub result: ImportResult,
}

#[derive(Default)]
pub struct Inbox {
    #[cfg(any(target_os = "ios", test))]
    next_id: u64,
    pending: VecDeque<OpenedDocument>,
}

impl Inbox {
    #[cfg(any(target_os = "ios", test))]
    pub fn push(&mut self, result: ImportResult) {
        self.next_id += 1;
        self.pending.push_back(OpenedDocument {
            id: self.next_id,
            result,
        });
    }
}

#[tauri::command]
pub fn pending_open_documents(
    inbox: tauri::State<'_, Mutex<Inbox>>,
) -> Result<Vec<OpenedDocument>, String> {
    Ok(inbox
        .lock()
        .map_err(|_| "unavailable")?
        .pending
        .iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub fn acknowledge_open_document(
    id: u64,
    inbox: tauri::State<'_, Mutex<Inbox>>,
) -> Result<(), String> {
    inbox
        .lock()
        .map_err(|_| "unavailable")?
        .pending
        .retain(|item| item.id != id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_cold_start_results_until_acknowledged() {
        let mut inbox = Inbox::default();
        inbox.push(ImportResult::default());
        inbox.push(ImportResult {
            error: Some("invalidEncoding".into()),
            ..Default::default()
        });
        let first_read = inbox.pending.iter().cloned().collect::<Vec<_>>();
        assert_eq!(inbox.pending.len(), 2);
        assert_ne!(first_read[0].id, first_read[1].id);
        inbox.pending.retain(|item| item.id != first_read[0].id);
        assert_eq!(
            inbox.pending[0].result.error.as_deref(),
            Some("invalidEncoding")
        );
        inbox.pending.retain(|item| item.id != first_read[0].id);
        assert_eq!(inbox.pending.len(), 1);
    }
}
