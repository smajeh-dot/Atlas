// Release builds must not open a console window next to the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod files;
mod paths;

use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;

/// Why the database could not be opened at start-up. Release builds have no console,
/// so the window stays open and shows this instead of the app quietly exiting.
struct StartupError(Option<String>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    data_dir: String,
    db_path: String,
    version: String,
    startup_error: Option<String>,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, startup: tauri::State<StartupError>) -> AppInfo {
    let dir = paths::data_dir();
    AppInfo {
        data_dir: dir.as_ref().map(|d| d.display().to_string()).unwrap_or_default(),
        db_path: dir
            .map(|d| d.join("atlas.db").display().to_string())
            .unwrap_or_default(),
        version: app.package_info().version.to_string(),
        startup_error: startup.0.clone(),
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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("media", |_ctx, request| files::serve_media(request))
        .setup(|app| {
            let opened = paths::ensure_dirs().and_then(|dir| {
                db::open(&dir.join("atlas.db"))
                    .map_err(|e| format!("Atlas couldn't open {}: {e}", dir.join("atlas.db").display()))
            });
            let (conn, error) = match opened {
                Ok(conn) => (Some(conn), None),
                Err(e) => (None, Some(e)),
            };
            app.manage(db::DbState(Mutex::new(conn)));
            app.manage(StartupError(error));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            db::db_query,
            db::db_execute,
            db::db_batch,
            files::media_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running Atlas");
}
