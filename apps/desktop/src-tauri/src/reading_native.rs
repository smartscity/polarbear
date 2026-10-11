use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct ReadingError {
    code: String,
    message: String,
}

fn failure(code: &str) -> ReadingError {
    ReadingError {
        code: code.into(),
        message: format!("Reading: {code}"),
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardRun {
    text: Option<String>,
    png: Option<String>,
    bold: Option<bool>,
    italic: Option<bool>,
    code: Option<bool>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentClipboard {
    markdown: String,
    html: String,
    runs: Vec<ClipboardRun>,
    expected_change_count: i64,
}

#[tauri::command]
pub async fn begin_document_copy(
    app: tauri::AppHandle,
    markdown: String,
) -> Result<i64, ReadingError> {
    #[cfg(target_os = "macos")]
    {
        let text = std::ffi::CString::new(markdown).map_err(|_| failure("invalidInput"))?;
        return on_main(app, move || {
            let count = unsafe { polarbear_clipboard_begin(text.as_ptr()) };
            if count < 0 {
                Err(failure("clipboardChanged"))
            } else {
                Ok(count)
            }
        })
        .await;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, markdown);
        Err(failure("unsupportedSystem"))
    }
}

#[tauri::command]
pub async fn write_document_copy(
    app: tauri::AppHandle,
    document: DocumentClipboard,
) -> Result<(), ReadingError> {
    let json = serde_json::to_string(&document).map_err(|_| failure("invalidInput"))?;
    if json.len() > 96 * 1024 * 1024 || document.runs.len() > 100_000 {
        return Err(failure("tooLarge"));
    }
    #[cfg(target_os = "macos")]
    {
        let json = std::ffi::CString::new(json).map_err(|_| failure("invalidInput"))?;
        return on_main(app, move || {
            match unsafe { polarbear_clipboard_write(json.as_ptr()) } {
                0 => Ok(()),
                1 => Err(failure("clipboardChanged")),
                _ => Err(failure("clipboardWriteFailed")),
            }
        })
        .await;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(failure("unsupportedSystem"))
    }
}

#[tauri::command]
pub async fn translate_reading_local(
    app: tauri::AppHandle,
    text: String,
) -> Result<String, ReadingError> {
    if text.trim().is_empty() || text.chars().count() > 2000 || text.contains('\0') {
        return Err(failure("invalidInput"));
    }
    #[cfg(target_os = "macos")]
    {
        let text = std::ffi::CString::new(text).map_err(|_| failure("invalidInput"))?;
        let (sender, receiver) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let context = Box::into_raw(Box::new(sender));
            unsafe {
                polarbear_translate_local(text.as_ptr(), context.cast(), translation_reply);
            }
        })
        .map_err(|_| failure("translationFailed"))?;
        return tauri::async_runtime::spawn_blocking(move || {
            let reply: String = receiver
                .recv_timeout(std::time::Duration::from_secs(60))
                .map_err(|_| failure("timeout"))?;
            let result: serde_json::Value =
                serde_json::from_str(&reply).map_err(|_| failure("translationFailed"))?;
            if let Some(error) = result.get("error").and_then(serde_json::Value::as_str) {
                return Err(failure(error));
            }
            result
                .get("text")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| failure("translationFailed"))
        })
        .await
        .map_err(|_| failure("translationFailed"))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(failure("unsupportedSystem"))
    }
}

#[cfg(target_os = "macos")]
async fn on_main<T: Send + 'static>(
    app: tauri::AppHandle,
    action: impl FnOnce() -> Result<T, ReadingError> + Send + 'static,
) -> Result<T, ReadingError> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(action());
    })
    .map_err(|_| failure("unavailable"))?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver.recv().map_err(|_| failure("unavailable"))?
    })
    .await
    .map_err(|_| failure("unavailable"))?
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn translation_reply(
    context: *mut std::ffi::c_void,
    json: *const std::ffi::c_char,
) {
    // Swift calls once; ownership stays with the callback even after a timeout.
    let sender = unsafe { Box::from_raw(context.cast::<std::sync::mpsc::Sender<String>>()) };
    let result = unsafe { std::ffi::CStr::from_ptr(json) }
        .to_string_lossy()
        .into_owned();
    let _ = sender.send(result);
}

#[cfg(target_os = "macos")]
extern "C" {
    fn polarbear_clipboard_begin(markdown: *const std::ffi::c_char) -> i64;
    fn polarbear_clipboard_write(json: *const std::ffi::c_char) -> i32;
    fn polarbear_translate_local(
        text: *const std::ffi::c_char,
        context: *mut std::ffi::c_void,
        reply: unsafe extern "C" fn(*mut std::ffi::c_void, *const std::ffi::c_char),
    );
}
