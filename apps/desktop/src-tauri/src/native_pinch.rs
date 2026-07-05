#[cfg(target_os = "macos")]
mod macos {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, ClassType};
    use objc2_app_kit::{NSEvent, NSView};
    use objc2_foundation::NSPoint;
    use serde::Serialize;
    use std::sync::OnceLock;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::{AppHandle, Emitter, Manager};

    const NATIVE_PINCH_EVENT: &str = "polarbear-native-pinch";

    // AppKit: NSEventTypeMagnify = 30, and NSEventMask is 1 << eventType.
    // Use the numeric value to avoid feature/version friction in objc2_app_kit bindings.
    const NSEVENT_TYPE_MAGNIFY: i64 = 30;
    const NSEVENT_MASK_MAGNIFY: usize = 1usize << NSEVENT_TYPE_MAGNIFY;
    const NSEVENT_PHASE_ENDED: u64 = 8;
    const NSEVENT_PHASE_CANCELLED: u64 = 16;

    static LOCAL_MONITOR: OnceLock<usize> = OnceLock::new();

    #[derive(Clone, Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct NativePinchPayload {
        delta: f64,
        x: f64,
        y: f64,
        timestamp: i64,
        source: &'static str,
        view_width: f64,
        view_height: f64,
        state: i64,
    }

    pub fn install_native_pinch(app: &tauri::App) -> Result<(), String> {
        let app_handle = app.handle().clone();

        let Some(window) = app.get_webview_window("main") else {
            // Keep this silent in normal runs; the app can still work without native pinch.
            return Ok(());
        };

        let ns_view_ptr = window.ns_view().map_err(|error| error.to_string())?;
        install_local_magnify_monitor(app_handle, ns_view_ptr as usize)
    }

    pub fn debug_emit_native_pinch(app_handle: &AppHandle) -> Result<(), String> {
        let payload = NativePinchPayload {
            delta: 0.12,
            x: 360.0,
            y: 260.0,
            timestamp: now_millis(),
            source: "debug_emit_native_pinch",
            view_width: 0.0,
            view_height: 0.0,
            state: -1,
        };

        emit_native_pinch_payload(app_handle, payload);
        Ok(())
    }

    fn install_local_magnify_monitor(
        app_handle: AppHandle,
        root_view_addr: usize,
    ) -> Result<(), String> {
        if LOCAL_MONITOR.get().is_some() {
            return Ok(());
        }

        let monitor_block: RcBlock<dyn Fn(*mut AnyObject) -> *mut AnyObject> =
            RcBlock::new(move |event: *mut AnyObject| -> *mut AnyObject {
                if event.is_null() {
                    return event;
                }

                let event_type: i64 = unsafe { msg_send![event, type] };
                if event_type != NSEVENT_TYPE_MAGNIFY {
                    return event;
                }

                let location_in_window: NSPoint = unsafe { msg_send![event, locationInWindow] };
                let phase: u64 = unsafe { msg_send![event, phase] };
                let delta: f64 = unsafe { msg_send![event, magnification] };
                let is_end_phase =
                    (phase & NSEVENT_PHASE_ENDED) != 0 || (phase & NSEVENT_PHASE_CANCELLED) != 0;
                if !delta.is_finite() || (delta.abs() < 0.000_000_1 && !is_end_phase) {
                    return event;
                }
                let (x, y, view_width, view_height) = root_view_metrics(
                    root_view_addr,
                    location_in_window.x,
                    location_in_window.y,
                );

                let payload = NativePinchPayload {
                    delta,
                    x,
                    y,
                    timestamp: now_millis(),
                    source: "NSEvent.addLocalMonitorForEventsMatchingMask.magnify",
                    view_width,
                    view_height,
                    state: phase as i64,
                };

                emit_native_pinch_payload(&app_handle, payload);

                // Return the original event so WebKit/Tauri can continue receiving it.
                // Returning null would swallow the event and may break normal WebView behavior.
                event
            });

        let monitor: *mut AnyObject = unsafe {
            msg_send![
                NSEvent::class(),
                addLocalMonitorForEventsMatchingMask: NSEVENT_MASK_MAGNIFY,
                handler: &*monitor_block
            ]
        };

        let _ = LOCAL_MONITOR.set(monitor as usize);

        // Keep the block alive for the process lifetime. The local monitor also retains/copies it,
        // but leaking here keeps ownership simple and avoids accidental drop during dev reloads.
        std::mem::forget(monitor_block);

        Ok(())
    }

    fn root_view_metrics(root_view_addr: usize, window_x: f64, window_y: f64) -> (f64, f64, f64, f64) {
        if root_view_addr == 0 {
            return (window_x, window_y, 0.0, 0.0);
        }

        let view = unsafe { &*(root_view_addr as *const NSView) };
        let bounds = view.bounds();

        // In the common Tauri layout, window coordinates and root view coordinates are aligned.
        // AppKit window/view coordinates are bottom-left based; browser clientY is top-left based.
        let x = window_x;
        let y = bounds.size.height - window_y;

        (x, y, bounds.size.width, bounds.size.height)
    }

    fn emit_native_pinch_payload(app_handle: &AppHandle, payload: NativePinchPayload) {
        if let Err(error) = app_handle.emit(NATIVE_PINCH_EVENT, payload.clone()) {
            eprintln!(
                "[native-pinch] app emit failed event={} error={:?}",
                NATIVE_PINCH_EVENT, error
            );
        }

        match app_handle.get_webview_window("main") {
            Some(window) => {
                if let Err(error) = window.emit(NATIVE_PINCH_EVENT, payload) {
                    eprintln!(
                        "[native-pinch] window emit failed label=main event={} error={:?}",
                        NATIVE_PINCH_EVENT, error
                    );
                }
            }
            None => eprintln!("[native-pinch] main webview window not found during emit"),
        }
    }

    fn now_millis() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0)
    }
}

#[cfg(target_os = "macos")]
pub use macos::{debug_emit_native_pinch, install_native_pinch};

#[cfg(not(target_os = "macos"))]
pub fn install_native_pinch(_app: &tauri::App) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn debug_emit_native_pinch(app_handle: &tauri::AppHandle) -> Result<(), String> {
    use serde_json::json;
    use tauri::Emitter;

    app_handle
        .emit(
            "polarbear-native-pinch",
            json!({
                "delta": 0.12,
                "x": 360.0,
                "y": 260.0,
                "timestamp": 0,
                "source": "debug_emit_native_pinch",
                "viewWidth": 0.0,
                "viewHeight": 0.0,
                "state": -1
            }),
        )
        .map_err(|error| format!("Failed to emit debug native pinch event: {error}"))
}
