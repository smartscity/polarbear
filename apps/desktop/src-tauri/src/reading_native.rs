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

#[tauri::command]
pub async fn begin_image_copy(app: tauri::AppHandle) -> Result<i64, ReadingError> {
    #[cfg(target_os = "macos")]
    {
        on_main(app, move || Ok(unsafe { polarbear_image_copy_begin() })).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(failure("unsupportedSystem"))
    }
}

#[tauri::command]
pub async fn write_clipboard_image(
    app: tauri::AppHandle,
    png: String,
    expected_change_count: i64,
) -> Result<(), ReadingError> {
    if png.len() > 48 * 1024 * 1024 {
        return Err(failure("tooLarge"));
    }
    #[cfg(target_os = "macos")]
    {
        let png = std::ffi::CString::new(png).map_err(|_| failure("invalidInput"))?;
        on_main(app, move || {
            match unsafe { polarbear_clipboard_image(png.as_ptr(), expected_change_count) } {
                0 => Ok(()),
                1 => Err(failure("clipboardChanged")),
                _ => Err(failure("clipboardWriteFailed")),
            }
        })
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, expected_change_count);
        Err(failure("unsupportedSystem"))
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
    heading: Option<u8>,
    link: Option<String>,
    table: Option<ClipboardCell>,
}

#[derive(Deserialize, Serialize)]
pub struct ClipboardCell {
    id: u32,
    row: u32,
    column: u32,
    columns: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentClipboard {
    markdown: String,
    plain_text: Option<String>,
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
        on_main(app, move || {
            let count = unsafe { polarbear_clipboard_begin(text.as_ptr()) };
            if count < 0 {
                Err(failure("clipboardChanged"))
            } else {
                Ok(count)
            }
        })
        .await
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
        on_main(app, move || {
            match unsafe { polarbear_clipboard_write(json.as_ptr()) } {
                0 => Ok(()),
                1 => Err(failure("clipboardChanged")),
                _ => Err(failure("clipboardWriteFailed")),
            }
        })
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(failure("unsupportedSystem"))
    }
}

#[tauri::command]
pub async fn speak_reading(
    app: tauri::AppHandle,
    text: String,
    accent: String,
) -> Result<(), ReadingError> {
    if text.trim().is_empty()
        || text.chars().count() > 8000
        || !["en-US", "en-GB"].contains(&accent.as_str())
    {
        return Err(failure("invalidInput"));
    }
    #[cfg(target_os = "macos")]
    {
        let text = std::ffi::CString::new(text).map_err(|_| failure("invalidInput"))?;
        let accent = std::ffi::CString::new(accent).map_err(|_| failure("invalidInput"))?;
        on_main(app, move || {
            if unsafe { polarbear_speak_reading(text.as_ptr(), accent.as_ptr()) } == 0 {
                Ok(())
            } else {
                Err(failure("speechUnavailable"))
            }
        })
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(failure("unsupportedSystem"))
    }
}

#[tauri::command]
pub async fn stop_reading_speech(app: tauri::AppHandle) -> Result<(), ReadingError> {
    #[cfg(target_os = "macos")]
    {
        on_main(app, move || {
            unsafe {
                polarbear_stop_reading();
            }
            Ok(())
        })
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
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
extern "C" {
    fn polarbear_image_copy_begin() -> i64;
    fn polarbear_clipboard_image(png: *const std::ffi::c_char, count: i64) -> i32;
    fn polarbear_clipboard_begin(markdown: *const std::ffi::c_char) -> i64;
    fn polarbear_clipboard_write(json: *const std::ffi::c_char) -> i32;
    fn polarbear_speak_reading(
        text: *const std::ffi::c_char,
        locale: *const std::ffi::c_char,
    ) -> i32;
    fn polarbear_stop_reading();
}
