mod runtime;
mod store;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicI64, Ordering},
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
    panel_seen: AtomicI64,
    paused_at: Mutex<Option<Instant>>,
}

impl CaptionService {
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
    Open {
        history: bool,
    },
    Start {
        source: String,
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
    Export {
        text: String,
        format: String,
    },
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
    if window.label() == "live-caption" && matches!(request, Request::Status) {
        app.state::<CaptionService>()
            .panel_seen
            .store(store::now(), Ordering::Release);
    }
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
        Request::Status => Ok(json!(service
            .status
            .lock()
            .map_err(|_| CaptionError::new("engineFailed"))?
            .clone())),
        Request::Open { history } => {
            open_window(app, history)?;
            Ok(Value::Null)
        }
        Request::Start { source, timezone } => {
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
                view_revision: current.view_revision.wrapping_add(1),
                ..Default::default()
            };
            match runtime::launch(app.clone(), id.clone(), source, 0, 0) {
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
            )?;
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
