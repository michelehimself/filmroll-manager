mod processor;
mod reader;
mod sheet;
mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|_window, event| eprintln!("[window] {event:?}"))
        .invoke_handler(tauri::generate_handler![
            processor::list_images,
            processor::reverse_order,
            processor::write_metadata,
            processor::rename_files,
            processor::rotate_images,
            processor::set_rating,
            processor::write_edits,
            reader::read_folder,
            reader::get_thumbnail,
            reader::get_preview,
            reader::open_folder,
            reader::check_folders,
            sheet::contact_sheet_layout,
            sheet::save_contact_sheet,
            store::load_store,
            store::save_store
        ])
        .run(tauri::generate_context!())
        .expect("error while running FilmRoll Manager");
}
