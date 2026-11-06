//! Tauri commands for backups. Deliberately thin: the work is done (and tested) in the
//! `atlas-backup` crate; this file only finds the folders and keeps backups and restores
//! from running at the same time.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use atlas_backup::{BackupInfo, Kind};
use serde::Serialize;
use tauri::Manager;

use crate::db::{self, DbState};
use crate::paths;

/// Held while a backup or a restore runs, so the two can never overlap.
pub struct BackupLock(pub Arc<Mutex<()>>);

impl BackupLock {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(())))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupDto {
    name: String,
    kind: String,
    created_at: u64,
    size_bytes: u64,
}

impl From<BackupInfo> for BackupDto {
    fn from(b: BackupInfo) -> Self {
        Self {
            name: b.name,
            kind: b.kind.as_str().into(),
            created_at: b.created_at_ms,
            size_bytes: b.size_bytes,
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// (atlas.db, backups folder)
fn folders() -> Result<(PathBuf, PathBuf), String> {
    let dir = paths::data_dir().ok_or("Windows did not report a user data folder (%APPDATA%).")?;
    Ok((dir.join("atlas.db"), dir.join("backups")))
}

/// One backup of the database, made on its own connection so the app's is never held up.
/// Used by the commands below and by the Anki import.
pub(crate) async fn make(lock: Arc<Mutex<()>>, kind: Kind) -> Result<BackupInfo, String> {
    let (db_path, backups) = folders()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _held = lock.lock().map_err(|e| e.to_string())?;
        atlas_backup::create(&db_path, &backups, kind, now_ms()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn backup_create(
    lock: tauri::State<'_, BackupLock>,
    kind: String,
) -> Result<BackupDto, String> {
    let kind = Kind::parse(&kind).ok_or("Unknown kind of backup.")?;
    make(lock.0.clone(), kind).await.map(Into::into)
}

#[tauri::command]
pub async fn backup_list() -> Result<Vec<BackupDto>, String> {
    let (_, backups) = folders()?;
    tauri::async_runtime::spawn_blocking(move || {
        atlas_backup::list(&backups)
            .map(|all| all.into_iter().map(Into::into).collect())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Puts a backup back as the database. `max_version` is the newest data format this Atlas
/// understands; the page upgrades an older backup afterwards.
#[tauri::command]
pub async fn backup_restore(
    app: tauri::AppHandle,
    lock: tauri::State<'_, BackupLock>,
    name: String,
    max_version: u32,
) -> Result<(), String> {
    let (db_path, backups) = folders()?;
    let lock = lock.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _held = lock.lock().map_err(|e| e.to_string())?;
        let state = app.state::<DbState>();
        let mut slot = state.0.lock().map_err(|e| e.to_string())?;
        atlas_backup::restore(&mut *slot, &db_path, &backups, &name, max_version, now_ms(), |p| db::open(p))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// On launch: remove half-written backups and a half-staged restore left by a crash.
pub fn clean_up_after_crash(data_dir: &Path) {
    atlas_backup::clean_temps(&data_dir.join("backups"));
    atlas_backup::clean_restore_temp(&data_dir.join("atlas.db"));
}
