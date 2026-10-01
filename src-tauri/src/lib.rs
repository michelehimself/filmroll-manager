mod processor;
mod reader;
mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|_window, event| eprintln!("[window] {event:?}"))
        .invoke_handler(tauri::generate_handler![
            processor::list_images,
            processor::reverse_order,
            processor::write_metadata,
            processor::rename_files,
            reader::read_folder,
            reader::get_thumbnail,
            store::load_store,
            store::save_store
        ])
        .run(tauri::generate_context!())
        .expect("error while running FilmRoll Manager");
}
