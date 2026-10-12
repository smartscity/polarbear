mod opened_documents;

use opened_documents::{acknowledge_open_document, pending_open_documents, Inbox};
use std::sync::Mutex;
use tauri::{plugin::TauriPlugin, Manager, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_reader);

#[cfg(target_os = "ios")]
struct MobileReader<R: Runtime> {
    handle: tauri::plugin::PluginHandle<R>,
    imports: tauri::async_runtime::Mutex<()>,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("reader")
        .invoke_handler(tauri::generate_handler![
            pending_open_documents,
            acknowledge_open_document
        ])
        .setup(|_app, _api| {
            _app.manage(Mutex::new(Inbox::default()));
            #[cfg(target_os = "ios")]
            _app.manage(MobileReader {
                handle: _api.register_ios_plugin(init_plugin_reader)?,
                imports: tauri::async_runtime::Mutex::new(()),
            });
            Ok(())
        })
        .on_event(|_app, _event| {
            #[cfg(target_os = "ios")]
            if let tauri::RunEvent::Opened { urls } = _event {
                use opened_documents::ImportResult;
                use tauri::Emitter;
                #[derive(serde::Serialize)]
                struct OpenArgs {
                    url: String,
                }
                let app = _app.clone();
                let urls = urls.clone();
                tauri::async_runtime::spawn(async move {
                    let mobile = app.state::<MobileReader<R>>();
                    let _serial = mobile.imports.lock().await;
                    for url in urls {
                        // Only OS-delivered URLs reach this native method; it has no WebView permission.
                        let result = mobile
                            .handle
                            .run_mobile_plugin_async::<ImportResult>(
                                "openDocument",
                                OpenArgs {
                                    url: url.to_string(),
                                },
                            )
                            .await
                            .unwrap_or_else(|_| ImportResult {
                                entries: vec![],
                                error: Some("unavailable".into()),
                            });
                        if let Ok(mut inbox) = app.state::<Mutex<Inbox>>().lock() {
                            inbox.push(result);
                        }
                        // The inbox is authoritative; a missed event is recovered on startup/resume.
                        let _ = app.emit("reader://document-opened", ());
                    }
                });
            }
        })
        .build()
}
