//! Native fullscreen transitions must not leave keyboard input on the host view.

#[cfg(any(target_os = "macos", test))]
#[derive(Default)]
struct FullscreenTransition {
    fullscreen: bool,
}

#[cfg(any(target_os = "macos", test))]
impl FullscreenTransition {
    fn exited(&mut self, fullscreen: bool) -> bool {
        let exited = self.fullscreen && !fullscreen;
        self.fullscreen = fullscreen;
        exited
    }
}

#[cfg(any(target_os = "macos", test))]
fn should_restore(
    key_window: bool,
    host_has_focus: bool,
    sheet_open: bool,
    fullscreen: bool,
) -> bool {
    key_window && host_has_focus && !sheet_open && !fullscreen
}

#[cfg(target_os = "macos")]
pub fn install(app: &tauri::App) -> tauri::Result<()> {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSResponder, NSView, NSWindowStyleMask};
    use objc2_foundation::NSOperationQueue;
    use std::sync::Mutex;
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let transition = Mutex::new(FullscreenTransition {
        fullscreen: window.is_fullscreen()?,
    });
    let handle = app.handle().clone();
    window.on_window_event(move |event| {
        if !matches!(event, tauri::WindowEvent::Resized(_)) {
            return;
        }
        let Some(window) = handle.get_webview_window("main") else {
            return;
        };
        let Ok(fullscreen) = window.is_fullscreen() else {
            return;
        };
        let restore = transition
            .lock()
            .is_ok_and(|mut state| state.exited(fullscreen));
        if !restore {
            return;
        }
        // Tao restores the window style on exit and focuses its host NSView.
        // Queue behind that style change, then recheck native focus. Never reset
        // document state or history, and never steal another control's focus.
        let webview_window = window.clone();
        if let Err(error) = window.with_webview(move |webview| unsafe {
            // Tauri owns this WKWebView and invokes the callback on the main thread.
            let Some(view) = Retained::retain(webview.inner() as *mut NSView) else {
                return;
            };
            let restore = RcBlock::new(move || {
                let Some(window) = view.window() else { return };
                let responder = window.firstResponder();
                let host = window.contentView();
                let host_has_focus = responder.as_ref().is_none_or(|responder| {
                    std::ptr::eq::<NSResponder>(responder.as_ref(), window.as_ref())
                        || host.as_ref().is_some_and(|host| {
                            std::ptr::eq::<NSResponder>(responder.as_ref(), host.as_ref())
                        })
                });
                if should_restore(
                    window.isKeyWindow(),
                    host_has_focus,
                    window.attachedSheet().is_some(),
                    window.styleMask().contains(NSWindowStyleMask::FullScreen),
                ) {
                    window.makeFirstResponder(Some(&view));
                    // WebKit may reset its DOM range while CodeMirror retains
                    // the correct selection. Let the focused editor reconcile it.
                    let event = crate::ipc_contracts::NATIVE_FULLSCREEN_RESTORED_EVENT;
                    let script = format!("window.dispatchEvent(new Event('{event}'));");
                    if let Err(error) = webview_window.eval(&script) {
                        eprintln!("Failed to synchronize fullscreen selection: {error}");
                    }
                }
            });
            // Retaining the view keeps the queued callback safe if the window
            // closes; all AppKit access remains on the main operation queue.
            NSOperationQueue::mainQueue().addOperationWithBlock(&restore);
        }) {
            eprintln!("Failed to restore fullscreen webview focus: {error}");
        }
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &tauri::App) -> tauri::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_once_after_a_fullscreen_exit_not_an_ordinary_resize() {
        let mut state = FullscreenTransition::default();
        assert!(!state.exited(false));
        assert!(!state.exited(true));
        assert!(!state.exited(true));
        assert!(state.exited(false));
        assert!(!state.exited(false));
        assert!(!state.exited(true));
        assert!(state.exited(false));
    }

    #[test]
    fn tracks_a_window_that_was_already_fullscreen_at_installation() {
        let mut state = FullscreenTransition { fullscreen: true };
        assert!(state.exited(false));
    }

    #[test]
    fn does_not_steal_focus_from_another_window_control_or_sheet() {
        assert!(should_restore(true, true, false, false));
        assert!(!should_restore(false, true, false, false));
        assert!(!should_restore(true, false, false, false));
        assert!(!should_restore(true, true, true, false));
        assert!(!should_restore(true, true, false, true));
    }
}
