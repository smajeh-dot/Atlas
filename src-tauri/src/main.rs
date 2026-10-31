// Release builds must not open a console window next to the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod paths;

use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    data_dir: String,
    db_path: String,
    version: String,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppInfo {
    let dir = paths::data_dir();
    AppInfo {
        data_dir: dir.display().to_string(),
        db_path: dir.join("atlas.db").display().to_string(),
        version: app.package_info().version.to_string(),
    }
}

fn main() {
    tauri::Builder::default()
        // Must be registered first: a second launch hands over to the running
        // window instead of opening the database twice.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = paths::ensure_dirs()?;
            let conn = db::open(&dir.join("atlas.db"))?;
            app.manage(db::DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            db::db_query,
            db::db_execute,
            db::db_batch
        ])
        .run(tauri::generate_context!())
        .expect("error while running Atlas");
}
