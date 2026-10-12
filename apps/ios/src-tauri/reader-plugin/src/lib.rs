use tauri::{plugin::TauriPlugin, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_reader);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("reader")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_reader)?;
            Ok(())
        })
        .build()
}
