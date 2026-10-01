mod processor;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            processor::list_images,
            processor::reverse_order,
            processor::write_metadata,
            processor::rename_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running FilmRoll Manager");
}
