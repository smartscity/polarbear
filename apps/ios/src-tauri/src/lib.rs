#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_reader::init())
        .run(tauri::generate_context!())
        .expect("Unable to start the Polarbear reader");
}
