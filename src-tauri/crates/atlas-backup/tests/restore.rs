//! Checking a backup and staging a restore, against real files.

use atlas_backup::{create, finish_restore, inspect, stage_restore, Error, Kind};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// An Atlas-shaped database: `meta` with a schema version, plus `notes` and `cards`.
fn atlas_db(path: &Path, version: u32, marker: i64) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(&format!(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE notes (x); CREATE TABLE cards (y);
         INSERT INTO meta VALUES ('schema_version', '{version}');
         INSERT INTO notes VALUES ({marker});"
    ))
    .unwrap();
}

fn marker(path: &Path) -> i64 {
    Connection::open(path).unwrap().query_row("SELECT SUM(x) FROM notes", [], |r| r.get(0)).unwrap()
}

/// A folder with a live database (marker 1) and one backup of an older one (marker 50, version `v`).
fn setup(v: u32) -> (TempDir, PathBuf, PathBuf, String) {
    let dir = TempDir::new().unwrap();
    let old = dir.path().join("old.db");
    atlas_db(&old, v, 50);
    let backups = dir.path().join("backups");
    let info = create(&old, &backups, Kind::Daily, 777).unwrap();
    let live = dir.path().join("atlas.db");
    atlas_db(&live, 2, 1);
    (dir, backups, live, info.name)
}

fn refused(r: Result<impl std::fmt::Debug, Error>) -> String {
    match r {
        Err(Error::Invalid(m)) => m,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn inspect_reads_the_schema_version() {
    let (_d, backups, _live, name) = setup(2);
    assert_eq!(inspect(&backups.join(name)).unwrap().schema_version, 2);
}

#[test]
fn inspect_refuses_a_corrupt_file() {
    let dir = TempDir::new().unwrap();
    let junk = dir.path().join("daily-1.db");
    std::fs::write(&junk, vec![7u8; 8192]).unwrap();
    refused(inspect(&junk));
}

#[test]
fn inspect_refuses_a_non_atlas_database() {
    let dir = TempDir::new().unwrap();
    let other = dir.path().join("daily-1.db");
    Connection::open(&other).unwrap().execute_batch("CREATE TABLE t (x); INSERT INTO t VALUES (1);").unwrap();
    refused(inspect(&other));
}

#[test]
fn stage_restore_refuses_a_newer_version() {
    let (_d, backups, live, name) = setup(5);
    let msg = refused(stage_restore(&backups, &name, &live, 2));
    assert!(msg.contains("newer"), "{msg}");
}

#[test]
fn stage_restore_refuses_names_with_path_separators_or_unknown_names() {
    let (dir, backups, live, _name) = setup(2);
    // A real database outside the backups folder must not be reachable by name.
    for bad in ["..\\old.db", "../old.db", "daily-999.db", "", "backups/daily-777.db"] {
        refused(stage_restore(&backups, bad, &live, 2));
    }
    assert!(dir.path().join("old.db").exists());
}

#[test]
fn stage_restore_copies_beside_the_database_and_leaves_current_data_untouched() {
    let (_d, backups, live, name) = setup(2);
    let staged = stage_restore(&backups, &name, &live, 2).unwrap();
    assert_eq!(staged.parent(), live.parent());
    assert_eq!(marker(&staged), 50);
    assert_eq!(marker(&live), 1);
}

#[test]
fn finish_restore_replaces_the_database_and_removes_stale_wal_and_shm() {
    let (_d, backups, live, name) = setup(2);
    let staged = stage_restore(&backups, &name, &live, 2).unwrap();
    let mut wal = live.clone().into_os_string();
    wal.push("-wal");
    let mut shm = live.clone().into_os_string();
    shm.push("-shm");
    std::fs::write(&wal, b"stale").unwrap();
    std::fs::write(&shm, b"stale").unwrap();
    finish_restore(&staged, &live).unwrap();
    assert_eq!(marker(&live), 50);
    assert!(!staged.exists());
    assert!(!Path::new(&wal).exists() && !Path::new(&shm).exists());
}
