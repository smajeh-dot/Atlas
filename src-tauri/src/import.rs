//! Tauri commands for importing Anki packages. Deliberately thin: the work is
//! done (and tested) in the `anki-package` crate and in TypeScript; this file
//! only moves data between them and keeps the one import's state.

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use anki_package::{ImportError, InstallFile, WorkDir};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::db::{query_rows, DbState};
use crate::paths;

/// The import being prepared or run, if any. Only one at a time.
pub struct ImportState(pub Mutex<Option<ActiveImport>>);

pub struct ActiveImport {
    // Fields drop in order: the connection closes before the folder is deleted,
    // which Windows needs.
    staging: Connection,
    work: WorkDir,
}

/// What the UI receives when a command fails: a stable code and a message
/// written for the student. Library errors only ever reach `detail`.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    code: String,
    message: String,
    detail: String,
}

impl From<ImportError> for CommandError {
    fn from(e: ImportError) -> Self {
        Self { code: e.code().into(), message: e.message(), detail: e.detail() }
    }
}

fn io_error(e: impl ToString) -> CommandError {
    ImportError::Io(e.to_string()).into()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareResult {
    format: String,
    notes: u64,
    cards: u64,
    reviews: u64,
    media: u64,
}

/// Reads the chosen .apkg into a fresh work folder and keeps the staging
/// database open for `staging_query`.
#[tauri::command]
pub async fn import_prepare(
    state: tauri::State<'_, ImportState>,
    path: String,
) -> Result<PrepareResult, CommandError> {
    // Choosing a new file ends any earlier import's work folder.
    state.0.lock().map_err(io_error)?.take();
    let tmp = paths::data_dir().join("tmp");
    let joined = tauri::async_runtime::spawn_blocking(
        move || -> Result<(ActiveImport, PrepareResult), CommandError> {
            let work = WorkDir::create_in(&tmp).map_err(|e| CommandError::from(ImportError::from(e)))?;
            let prepared = anki_package::prepare(Path::new(&path), work.path())?;
            let staging = Connection::open_with_flags(
                &prepared.staging_path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .map_err(io_error)?;
            let c = prepared.counts;
            let result = PrepareResult {
                format: prepared.format.as_str().into(),
                notes: c.notes,
                cards: c.cards,
                reviews: c.revlog,
                media: c.media,
            };
            Ok((ActiveImport { staging, work }, result))
        },
    )
    .await
    .map_err(io_error)?;
    let (active, result) = joined?;
    *state.0.lock().map_err(io_error)? = Some(active);
    Ok(result)
}

/// Read-only queries against the staging database (opened read-only, so even
/// a stray write can't change it).
#[tauri::command]
pub async fn staging_query(
    state: tauri::State<'_, ImportState>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let active = guard.as_ref().ok_or("no import is being prepared")?;
    query_rows(&active.staging, &sql, &params)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallFileDto {
    staged_path: String,
    name: String,
    sha1: String,
}

#[tauri::command]
pub async fn media_install(
    state: tauri::State<'_, ImportState>,
    files: Vec<InstallFileDto>,
) -> Result<(), CommandError> {
    let work = {
        let guard = state.0.lock().map_err(io_error)?;
        let active = guard.as_ref().ok_or_else(|| io_error("no import is being prepared"))?;
        active.work.path().to_path_buf()
    };
    let media = paths::data_dir().join("media");
    let files: Vec<InstallFile> = files
        .into_iter()
        .map(|f| InstallFile { staged_path: f.staged_path, name: f.name, sha1: f.sha1 })
        .collect();
    tauri::async_runtime::spawn_blocking(move || anki_package::install_media(&work, &media, &files))
        .await
        .map_err(io_error)?
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn media_remove(names: Vec<String>) -> Result<(), CommandError> {
    let media = paths::data_dir().join("media");
    tauri::async_runtime::spawn_blocking(move || anki_package::remove_media(&media, &names))
        .await
        .map_err(io_error)?
        .map_err(CommandError::from)
}

/// Copies atlas.db to backups\pre-import-<ms>.db and returns the path.
#[tauri::command]
pub async fn db_backup(db: tauri::State<'_, DbState>) -> Result<String, CommandError> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
        .to_string();
    let conn = db.0.lock().map_err(io_error)?;
    let path = anki_package::backup_database(&conn, &paths::data_dir().join("backups"), &stamp)?;
    Ok(path.display().to_string())
}

/// Ends the import: closes the staging database and deletes the work folder.
#[tauri::command]
pub async fn import_cleanup(state: tauri::State<'_, ImportState>) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.take();
    Ok(())
}

/// On launch, before anything else: clear work folders and half-copied media
/// left by an import that was cut off.
pub fn clean_up_after_crash(data_dir: &Path) {
    let _ = anki_package::remove_stale(&data_dir.join("tmp"));
    let _ = anki_package::remove_stale_media_temps(&data_dir.join("media"));
}
