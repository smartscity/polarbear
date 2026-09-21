use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub const OPEN_FILES_REQUESTED_EVENT: &str = "polarbear-open-files-requested";

#[derive(Default)]
pub struct PendingOpenFiles(Mutex<VecDeque<String>>);

impl PendingOpenFiles {
    fn enqueue(&self, paths: impl IntoIterator<Item = PathBuf>) -> Result<bool, String> {
        let mut pending = self
            .0
            .lock()
            .map_err(|_| "The system-open queue is unavailable.".to_owned())?;
        let mut changed = false;

        for path in paths {
            if !is_markdown_path(&path) {
                continue;
            }

            let path = path.to_string_lossy().to_string();
            if !pending.contains(&path) {
                pending.push_back(path);
                changed = true;
            }
        }

        Ok(changed)
    }

    fn drain(&self) -> Result<Vec<String>, String> {
        let mut pending = self
            .0
            .lock()
            .map_err(|_| "The system-open queue is unavailable.".to_owned())?;
        Ok(pending.drain(..).collect())
    }
}

pub fn markdown_paths_from_args(args: impl IntoIterator<Item = String>) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| path_from_launch_argument(&arg))
        .filter(|path| is_markdown_path(path))
        .collect()
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
pub fn markdown_paths_from_urls(urls: Vec<tauri::Url>) -> Vec<PathBuf> {
    urls.into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| is_markdown_path(path))
        .collect()
}

pub fn enqueue_open_files(app: &AppHandle, paths: Vec<PathBuf>) {
    let state = app.state::<PendingOpenFiles>();
    if !state.enqueue(paths).unwrap_or(false) {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit(OPEN_FILES_REQUESTED_EVENT, ());
}

#[tauri::command]
pub fn take_pending_open_files(
    state: tauri::State<'_, PendingOpenFiles>,
) -> Result<Vec<String>, String> {
    state.drain()
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

fn path_from_launch_argument(argument: &str) -> Option<PathBuf> {
    if argument.starts_with("file://") {
        return tauri::Url::parse(argument).ok()?.to_file_path().ok();
    }

    Some(PathBuf::from(argument))
}

#[cfg(test)]
mod tests {
    use super::markdown_paths_from_args;
    use std::path::PathBuf;

    #[test]
    fn extracts_markdown_files_from_gui_launch_arguments() {
        let paths = markdown_paths_from_args([
            "polarbear".to_owned(),
            "/Users/example/My Notes/readme.md".to_owned(),
            "/Users/example/notes.MARKDOWN".to_owned(),
            "file:///Users/example/Shared%20Notes/guide.md".to_owned(),
            "/Users/example/image.png".to_owned(),
        ]);

        assert_eq!(
            paths,
            vec![
                PathBuf::from("/Users/example/My Notes/readme.md"),
                PathBuf::from("/Users/example/notes.MARKDOWN"),
                PathBuf::from("/Users/example/Shared Notes/guide.md"),
            ]
        );
    }

    #[test]
    fn ignores_runtime_flags() {
        let paths = markdown_paths_from_args([
            "polarbear".to_owned(),
            "--inspect".to_owned(),
            "document.md".to_owned(),
        ]);

        assert_eq!(paths, vec![PathBuf::from("document.md")]);
    }
}
