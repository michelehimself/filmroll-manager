//! The user's own data (favorite films, later cameras and lenses) as one small
//! JSON file in the app's data folder. It never leaves the computer.

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "library.json";

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(FILE_NAME))
        .map_err(|e| format!("Could not find the app data folder: {e}"))
}

/// Missing file → empty store. A damaged file is kept as .bak and replaced by an empty store.
fn read_store(path: &Path) -> Value {
    let Ok(text) = fs::read_to_string(path) else { return json!({}) };
    match serde_json::from_str::<Value>(&text) {
        Ok(value) if value.is_object() => value,
        _ => {
            let _ = fs::copy(path, path.with_extension("json.bak"));
            json!({})
        }
    }
}

/// Writes to a temporary file first, so a crash never leaves a half-written store.
fn write_store(path: &Path, data: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&temp, text).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_store(app: AppHandle) -> Result<Value, String> {
    Ok(read_store(&store_path(&app)?))
}

#[tauri::command]
pub fn save_store(app: AppHandle, data: Value) -> Result<(), String> {
    if !data.is_object() {
        return Err("The stored data must be an object.".to_string());
    }
    write_store(&store_path(&app)?, &data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("filmroll_store_{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir.join("library.json")
    }

    #[test]
    fn missing_file_gives_empty_store() {
        assert_eq!(read_store(&temp_file("missing")), json!({}));
    }

    #[test]
    fn saved_data_comes_back() {
        let path = temp_file("roundtrip");
        let data = json!({ "favorites": ["Kodak Portra 400", "Ilford HP5 Plus 400"] });
        write_store(&path, &data).unwrap();
        assert_eq!(read_store(&path), data);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn damaged_file_is_backed_up() {
        let path = temp_file("damaged");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(read_store(&path), json!({}));
        assert_eq!(fs::read_to_string(path.with_extension("json.bak")).unwrap(), "{ not json");
    }
}
