mod recording;
mod runtime;
mod store;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

pub type CaptionResult<T> = Result<T, CaptionError>;
#[derive(Debug, Serialize)]
pub struct CaptionError {
    code: String,
    message: String,
}
impl CaptionError {
    pub fn new(code: &str) -> Self {
        Self {
            code: format!("caption.{code}"),
            message: format!("Live Caption: {code}"),
        }
    }
}

#[derive(Default)]
pub struct CaptionService {
    database: Mutex<Option<store::CaptionStore>>,
    status: Mutex<runtime::Status>,
    run: Mutex<Option<runtime::Run>>,
    control: Mutex<()>,
    generation: Mutex<i64>,
    exiting: AtomicBool,
    paused_at: Mutex<Option<Instant>>,
}

#[derive(Serialize)]
struct LiveSnapshot {
    status: runtime::Status,
    segments: Vec<store::Segment>,
}

impl CaptionService {
    fn live_snapshot(&self) -> CaptionResult<LiveSnapshot> {
        // All final commits acquire status before storage, so the provisional suffix
        // and durable tail cannot describe different sides of the same commit.
        let status = self
            .status
            .lock()
            .map_err(|_| CaptionError::new("engineFailed"))?;
        let segments = match &status.session_id {
            Some(id) => self.with_store(|db| db.tail(id))?,
            None => Vec::new(),
        };
        Ok(LiveSnapshot {
            status: status.clone(),
            segments,
        })
    }

    fn accept_partial(&self, session: &str, sequence: i64, english: &str) -> CaptionResult<()> {
        if sequence <= 0 || english.len() > 16384 {
            return Err(CaptionError::new("engineProtocol"));
        }
        let mut status = self
            .status
            .lock()
            .map_err(|_| CaptionError::new("engineFailed"))?;
        if status.session_id.as_deref() != Some(session)
            || sequence / 1_000_000 != status.capture_generation
        {
            return Ok(());
        }
        if sequence > status.final_sequence && sequence >= status.partial_sequence {
            status.partial_sequence = sequence;
            status.partial = english.into();
        }
        Ok(())
    }

    fn accept_final(
        &self,
        session: &str,
        sequence: i64,
        start: i64,
        end: i64,
        english: &str,
    ) -> CaptionResult<()> {
        let mut status = self
            .status
            .lock()
            .map_err(|_| CaptionError::new("engineFailed"))?;
        if status.session_id.as_deref() != Some(session)
            || sequence / 1_000_000 != status.capture_generation
        {
            return Ok(());
        }
        if sequence <= status.final_sequence {
            return Ok(());
        }
        let id = status
            .session_id
            .as_deref()
            .ok_or_else(|| CaptionError::new("engineProtocol"))?;
        self.with_store(|db| db.append(id, sequence, start, end, english))?;
        status.final_sequence = sequence;
        if status.partial_sequence <= sequence {
            status.partial.clear();
        }
        Ok(())
    }

    pub fn stop_serialized(&self) -> CaptionResult<()> {
        let _control = self
            .control
            .lock()
            .map_err(|_| CaptionError::new("engineFailed"))?;
        self.stop(false)
    }
    pub fn begin_exit(&self) -> bool {
        !self.exiting.swap(true, Ordering::AcqRel)
    }
    pub fn halt(&self) {
        runtime::stop_capture();
        if let Ok(run) = self.run.lock() {
            if let Some(run) = run.as_ref() {
                run.cancel.store(true, Ordering::Release);
            }
        }
    }
    fn initialize(&self, app: &tauri::AppHandle) -> CaptionResult<()> {
        let mut db = self
            .database
            .lock()
            .map_err(|_| CaptionError::new("storageFailed"))?;
        if db.is_none() {
            let path = app
                .path()
                .app_local_data_dir()
                .map_err(|_| CaptionError::new("storageFailed"))?
                .join("live-caption/history.sqlite3");
            let store = store::CaptionStore::open(&path)?;
            store.recover()?;
            *db = Some(store);
        }
        Ok(())
    }
    fn with_store<T>(
        &self,
        action: impl FnOnce(&store::CaptionStore) -> CaptionResult<T>,
    ) -> CaptionResult<T> {
        let db = self
            .database
            .lock()
            .map_err(|_| CaptionError::new("storageFailed"))?;
        action(
            db.as_ref()
                .ok_or_else(|| CaptionError::new("storageFailed"))?,
        )
    }
    pub fn stop(&self, pause: bool) -> CaptionResult<()> {
        runtime::stop_capture();
        let run = self
            .run
            .lock()
            .map_err(|_| CaptionError::new("engineFailed"))?
            .take();
        if let Some(run) = run {
            run.cancel.store(true, Ordering::Release);
            let _ = run.done.recv_timeout(Duration::from_secs(10));
        }
        let mut status = self
            .status
            .lock()
            .map_err(|_| CaptionError::new("engineFailed"))?;
        if let Some(id) = status.session_id.as_ref() {
            let state = if pause { "paused" } else { "stopped" };
            self.with_store(|db| db.state(id, state, status.elapsed_ms as i64, !pause))?;
            status.state = state.into();
            status.partial.clear();
        }
        *self
            .paused_at
            .lock()
            .map_err(|_| CaptionError::new("engineFailed"))? = pause.then(Instant::now);
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Status,
    Live,
    Open {
        history: bool,
    },
    Start {
        source: String,
        #[serde(default, rename = "recordAudio")]
        record_audio: bool,
        #[serde(default)]
        timezone: String,
    },
    Pause,
    Resume,
    Stop,
    List {
        query: String,
        offset: u32,
    },
    Segments {
        id: String,
        after: i64,
    },
    Tail {
        id: String,
    },
    Rename {
        id: String,
        title: String,
        place: String,
    },
    Delete {
        id: String,
    },
    Retry {
        id: String,
    },
    Claim,
    Complete {
        id: i64,
        lease: String,
        chinese: Option<String>,
    },
    Snapshot {
        id: String,
        #[serde(default)]
        export: bool,
    },
    Pin {
        pinned: bool,
    },
    RecordingsFolder,
    Export {
        text: String,
        format: String,
    },
}

fn recordings_directory(app: &tauri::AppHandle) -> CaptionResult<std::path::PathBuf> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|_| CaptionError::new("recordingsUnavailable"))?
        .join("live-caption/recordings");
    std::fs::create_dir_all(&directory).map_err(|_| CaptionError::new("recordingsUnavailable"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| CaptionError::new("recordingsUnavailable"))?;
    }
    Ok(directory)
}

fn open_window(app: &tauri::AppHandle, history: bool) -> CaptionResult<()> {
    {
        let service = app.state::<CaptionService>();
        let mut status = service
            .status
            .lock()
            .map_err(|_| CaptionError::new("engineFailed"))?;
        status.view_revision = status.view_revision.wrapping_add(1);
        status.history_requested = history;
    }
    if let Some(window) = app.get_webview_window("live-caption") {
        window
            .show()
            .map_err(|_| CaptionError::new("windowFailed"))?;
        window
            .set_focus()
            .map_err(|_| CaptionError::new("windowFailed"))?;
    } else {
        tauri::WebviewWindowBuilder::new(
            app,
            "live-caption",
            tauri::WebviewUrl::App(
                format!("caption.html?surface=caption&history={history}").into(),
            ),
        )
        .title("Live Caption")
        .inner_size(680.0, 300.0)
        .min_inner_size(360.0, 180.0)
        .always_on_top(true)
        .center()
        .build()
        .map_err(|_| CaptionError::new("windowFailed"))?;
    }
    if app.get_webview_window("caption-translator").is_none() {
        tauri::WebviewWindowBuilder::new(
            app,
            "caption-translator",
            tauri::WebviewUrl::App("caption.html?surface=caption-translator".into()),
        )
        .title("Live Caption translation")
        // This queue consumer must remain schedulable while its host is hidden.
        // WKWebView supports this policy on macOS 14+; older systems remain unqualified.
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .visible(false)
        .build()
        .map_err(|_| CaptionError::new("windowFailed"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn caption_request(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Request,
) -> CaptionResult<Value> {
    let worker = window.label() == "caption-translator";
    if worker != matches!(request, Request::Claim | Request::Complete { .. })
        || (!worker && !matches!(window.label(), "main" | "live-caption"))
    {
        return Err(CaptionError::new("forbidden"));
    }
    tauri::async_runtime::spawn_blocking(move || handle(&app, request))
        .await
        .map_err(|_| CaptionError::new("engineFailed"))?
}

fn handle(app: &tauri::AppHandle, request: Request) -> CaptionResult<Value> {
    let service = app.state::<CaptionService>();
    service.initialize(app)?;
    match request {
        Request::Live => Ok(json!(service.live_snapshot()?)),
        Request::Status => Ok(json!(service
            .status
            .lock()
            .map_err(|_| CaptionError::new("engineFailed"))?
            .clone())),
        Request::Open { history } => {
            open_window(app, history)?;
            Ok(Value::Null)
        }
        Request::Start {
            source,
            timezone,
            record_audio,
        } => {
            store::validate_time_zone(&timezone)?;
            if service.exiting.load(Ordering::Acquire) {
                return Err(CaptionError::new("invalidRequest"));
            }
            if source != "system" && source != "microphone" {
                return Err(CaptionError::new("unsupportedSource"));
            }
            let _control = service
                .control
                .lock()
                .map_err(|_| CaptionError::new("engineFailed"))?;
            let current = service
                .status
                .lock()
                .map_err(|_| CaptionError::new("engineFailed"))?
                .clone();
            if matches!(current.state.as_str(), "starting" | "capturing" | "paused") {
                open_window(app, false)?;
                return Ok(Value::Null);
            }
            service.stop(false)?;
            runtime::assets(app)?;
            open_window(app, false)?;
            let id = service.with_store(|db| db.create(&source))?;
            service.with_store(|db| {
                db.set_time_zone(
                    &id,
                    if timezone.is_empty() {
                        "UTC"
                    } else {
                        &timezone
                    },
                )
            })?;
            *service
                .status
                .lock()
                .map_err(|_| CaptionError::new("engineFailed"))? = runtime::Status {
                session_id: Some(id.clone()),
                state: "starting".into(),
                source: source.clone(),
                record_audio,
                view_revision: current.view_revision.wrapping_add(1),
                ..Default::default()
            };
            match runtime::launch(app.clone(), id.clone(), source, 0, 0, record_audio) {
                Ok(run) => {
                    *service
                        .run
                        .lock()
                        .map_err(|_| CaptionError::new("engineFailed"))? = Some(run);
                }
                Err(error) => {
                    service.with_store(|db| db.state(&id, "failed", 0, true))?;
                    service
                        .status
                        .lock()
                        .map_err(|_| CaptionError::new("engineFailed"))?
                        .state = "failed".into();
                    return Err(error);
                }
            }
            Ok(Value::Null)
        }
        Request::Pause | Request::Stop => {
            let _control = service
                .control
                .lock()
                .map_err(|_| CaptionError::new("engineFailed"))?;
            service.stop(matches!(request, Request::Pause))?;
            Ok(Value::Null)
        }
        Request::Resume => {
            let _control = service
                .control
                .lock()
                .map_err(|_| CaptionError::new("engineFailed"))?;
            let mut status = service
                .status
                .lock()
                .map_err(|_| CaptionError::new("engineFailed"))?;
            if status.state != "paused" {
                return Err(CaptionError::new("invalidRequest"));
            }
            let id = status
                .session_id
                .clone()
                .ok_or_else(|| CaptionError::new("invalidRequest"))?;
            let mut generation = service
                .generation
                .lock()
                .map_err(|_| CaptionError::new("engineFailed"))?;
            *generation += 1;
            let pause_duration = service
                .paused_at
                .lock()
                .map_err(|_| CaptionError::new("engineFailed"))?
                .as_ref()
                .map_or(0, |time| time.elapsed().as_millis() as u64);
            let run = runtime::launch(
                app.clone(),
                id,
                status.source.clone(),
                status.elapsed_ms.saturating_add(pause_duration),
                *generation,
                status.record_audio,
            )?;
            status.capture_generation = *generation;
            status.state = "starting".into();
            status.error = None;
            *service
                .run
                .lock()
                .map_err(|_| CaptionError::new("engineFailed"))? = Some(run);
            Ok(Value::Null)
        }
        Request::List { query, offset } => {
            if query.len() > 512 {
                return Err(CaptionError::new("invalidRequest"));
            }
            service.with_store(|db| Ok(json!(db.list(&query, offset)?)))
        }
        Request::Segments { id, after } => {
            service.with_store(|db| Ok(json!(db.segments(&id, after, 200)?)))
        }
        Request::Tail { id } => service.with_store(|db| Ok(json!(db.tail(&id)?))),
        Request::Rename { id, title, place } => service.with_store(|db| {
            db.rename(&id, &title, &place)?;
            Ok(Value::Null)
        }),
        Request::Delete { id } => {
            let status = service
                .status
                .lock()
                .map_err(|_| CaptionError::new("engineFailed"))?;
            if status.session_id.as_ref() == Some(&id)
                && matches!(status.state.as_str(), "starting" | "capturing" | "paused")
            {
                return Err(CaptionError::new("sessionActive"));
            }
            service.with_store(|db| {
                db.delete(&id)?;
                Ok(Value::Null)
            })
        }
        Request::Retry { id } => service.with_store(|db| {
            db.retry(&id)?;
            Ok(Value::Null)
        }),
        Request::Claim => service.with_store(|db| Ok(json!(db.claim()?))),
        Request::Complete { id, lease, chinese } => service.with_store(|db| {
            db.complete(id, &lease, chinese.as_deref())?;
            Ok(Value::Null)
        }),
        Request::Snapshot { id, export } => service.with_store(|db| {
            // The store mutex excludes concurrent updates for the entire bounded snapshot.
            let mut rows = Vec::new();
            let mut after = 0;
            let mut bytes = 0;
            loop {
                let page = db.segments(&id, after, 500)?;
                if page.is_empty() {
                    break;
                }
                for row in page {
                    after = row.id;
                    bytes += row.english.len() + row.chinese.as_ref().map_or(0, String::len) + 128;
                    if bytes > (if export { 64 } else { 8 }) * 1024 * 1024 {
                        return Err(CaptionError::new("copyTooLarge"));
                    }
                    rows.push(row);
                }
            }
            Ok(json!(rows))
        }),
        Request::Pin { pinned } => {
            if let Some(window) = app.get_webview_window("live-caption") {
                window
                    .set_always_on_top(pinned)
                    .map_err(|_| CaptionError::new("windowFailed"))?;
            }
            Ok(Value::Null)
        }
        Request::RecordingsFolder => {
            let directory = recordings_directory(app)?;
            #[cfg(target_os = "macos")]
            {
                let status = std::process::Command::new("/usr/bin/open")
                    .arg(directory)
                    .status()
                    .map_err(|_| CaptionError::new("recordingsUnavailable"))?;
                if !status.success() {
                    return Err(CaptionError::new("recordingsUnavailable"));
                }
                Ok(Value::Null)
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = directory;
                Err(CaptionError::new("unsupportedPlatform"))
            }
        }
        Request::Export { text, format } => {
            use tauri_plugin_dialog::DialogExt;
            if !["txt", "md", "srt"].contains(&format.as_str()) || text.len() > 64 * 1024 * 1024 {
                return Err(CaptionError::new("invalidRequest"));
            }
            if let Some(file) = app
                .dialog()
                .file()
                .set_file_name(format!("captions.{format}"))
                .add_filter("Transcript", &[format.as_str()])
                .blocking_save_file()
            {
                let path = file
                    .into_path()
                    .map_err(|_| CaptionError::new("exportFailed"))?;
                crate::atomic_write(&path, text.as_bytes())
                    .map_err(|_| CaptionError::new("exportFailed"))?;
                return Ok(json!(true));
            }
            Ok(json!(false))
        }
    }
}
