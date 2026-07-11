use std::sync::Mutex;

use tauri::{Emitter, State, WebviewWindow};

use crate::ipc_contracts;

const DEFAULT_APP_ZOOM: f64 = 1.0;
const MIN_APP_ZOOM: f64 = 0.5;
const MAX_APP_ZOOM: f64 = 3.0;

pub(crate) struct AppZoomState {
    zoom: Mutex<f64>,
}

impl Default for AppZoomState {
    fn default() -> Self {
        Self {
            zoom: Mutex::new(DEFAULT_APP_ZOOM),
        }
    }
}

fn clamp_app_zoom(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(MIN_APP_ZOOM, MAX_APP_ZOOM)
    } else {
        DEFAULT_APP_ZOOM
    }
}

#[tauri::command]
pub(crate) fn set_app_zoom(
    window: WebviewWindow,
    state: State<'_, AppZoomState>,
    zoom: f64,
) -> Result<f64, String> {
    let next_zoom = clamp_app_zoom(zoom);

    window
        .set_zoom(next_zoom)
        .map_err(|error| format!("Failed to set WebView zoom: {error}"))?;

    {
        let mut current_zoom = state
            .zoom
            .lock()
            .map_err(|_| "Failed to lock app zoom state.".to_owned())?;
        *current_zoom = next_zoom;
    }

    let _ = window.emit(ipc_contracts::APP_ZOOM_CHANGED_EVENT, next_zoom);

    Ok(next_zoom)
}
