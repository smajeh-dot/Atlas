//! Making, listing and tidying backups, against real files.

use atlas_backup::{clean_temps, create, list, Kind};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// A small WAL-mode database like Atlas's, with three notes.
fn make_db(dir: &Path) -> PathBuf {
    let path = dir.join("atlas.db");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; CREATE TABLE notes (x); INSERT INTO notes VALUES (1), (2), (3);",
    )
    .unwrap();
    path
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[test]
fn create_makes_a_complete_copy_named_kind_and_stamp() {
    let dir = TempDir::new().unwrap();
    let db = make_db(dir.path());
    // The app's own connection stays open and keeps writing while the backup runs.
    let live = Connection::open(&db).unwrap();
    live.execute("INSERT INTO notes VALUES (4)", []).unwrap();
    let backups = dir.path().join("backups");
    let info = create(&db, &backups, Kind::Daily, 1_700_000_000_000).unwrap();
    assert_eq!(info.name, "daily-1700000000000.db");
    assert_eq!(info.kind, Kind::Daily);
    assert_eq!(info.created_at_ms, 1_700_000_000_000);
    assert!(info.size_bytes > 0);
    let copy = Connection::open(backups.join(&info.name)).unwrap();
    let sum: i64 = copy.query_row("SELECT SUM(x) FROM notes", [], |r| r.get(0)).unwrap();
    assert_eq!(sum, 10);
}

#[test]
fn create_leaves_no_tmp_file_and_no_partial_on_failure() {
    let dir = TempDir::new().unwrap();
    let backups = dir.path().join("backups");
    // A source that does not exist.
    assert!(create(&dir.path().join("missing.db"), &backups, Kind::Manual, 5).is_err());
    // A source that is not a database.
    let junk = dir.path().join("junk.db");
    std::fs::write(&junk, b"this is not sqlite at all, just some text padding it out to a page").unwrap();
    assert!(create(&junk, &backups, Kind::Manual, 6).is_err());
    let left: Vec<String> = if backups.exists() { names(&backups) } else { vec![] };
    assert!(left.is_empty(), "left behind: {left:?}");
}

#[test]
fn same_millisecond_twice_does_not_overwrite() {
    let dir = TempDir::new().unwrap();
    let db = make_db(dir.path());
    let backups = dir.path().join("backups");
    let a = create(&db, &backups, Kind::PreDelete, 100).unwrap();
    let b = create(&db, &backups, Kind::PreDelete, 100).unwrap();
    assert_eq!(a.name, "pre-delete-100.db");
    assert_eq!(b.name, "pre-delete-101.db");
    assert_eq!(names(&backups).len(), 2);
}

#[test]
fn each_pile_keeps_only_its_limit_and_prunes_oldest() {
    let dir = TempDir::new().unwrap();
    let db = make_db(dir.path());
    let backups = dir.path().join("backups");
    for i in 0..8 {
        create(&db, &backups, Kind::Daily, 1000 + i).unwrap();
    }
    let daily: Vec<u64> = list(&backups).unwrap().iter().map(|b| b.created_at_ms).collect();
    assert_eq!(daily, vec![1007, 1006, 1005, 1004, 1003, 1002, 1001]);
    for i in 0..4 {
        create(&db, &backups, Kind::PreUpgrade, 2000 + i).unwrap();
    }
    let upgrades = list(&backups).unwrap().into_iter().filter(|b| b.kind == Kind::PreUpgrade).count();
    assert_eq!(upgrades, 3);
    for i in 0..11 {
        create(&db, &backups, Kind::Manual, 3000 + i).unwrap();
    }
    let manual = list(&backups).unwrap().into_iter().filter(|b| b.kind == Kind::Manual).count();
    assert_eq!(manual, 10);
}

#[test]
fn piles_do_not_evict_each_other() {
    let dir = TempDir::new().unwrap();
    let db = make_db(dir.path());
    let backups = dir.path().join("backups");
    for i in 0..7 {
        create(&db, &backups, Kind::Daily, 100 + i).unwrap();
    }
    // Safety copies of three kinds share one pile of ten.
    for i in 0..5 {
        create(&db, &backups, Kind::PreDelete, 1000 + i).unwrap();
        create(&db, &backups, Kind::PreImport, 2000 + i).unwrap();
        create(&db, &backups, Kind::PreRestore, 3000 + i).unwrap();
    }
    let all = list(&backups).unwrap();
    assert_eq!(all.iter().filter(|b| b.kind == Kind::Daily).count(), 7);
    let safety: Vec<&_> = all.iter().filter(|b| matches!(b.kind, Kind::PreDelete | Kind::PreImport | Kind::PreRestore)).collect();
    assert_eq!(safety.len(), 10);
    // The oldest five (the pre-delete ones, stamps 1000..1004) are the ones that went.
    assert!(safety.iter().all(|b| b.created_at_ms >= 2000));
}

#[test]
fn files_that_are_not_backups_are_never_touched_or_listed() {
    let dir = TempDir::new().unwrap();
    let db = make_db(dir.path());
    let backups = dir.path().join("backups");
    std::fs::create_dir_all(&backups).unwrap();
    for stray in ["notes.txt", "daily-abc.db", "daily-123.db.bak", "weekly-5.db", "daily-.db"] {
        std::fs::write(backups.join(stray), b"mine").unwrap();
    }
    for i in 0..9 {
        create(&db, &backups, Kind::Daily, 10 + i).unwrap();
    }
    clean_temps(&backups);
    let listed = list(&backups).unwrap();
    assert!(listed.iter().all(|b| b.name.starts_with("daily-1") || b.name.starts_with("daily-2")));
    assert_eq!(listed.len(), 7);
    for stray in ["notes.txt", "daily-abc.db", "daily-123.db.bak", "weekly-5.db", "daily-.db"] {
        assert!(backups.join(stray).exists(), "{stray} was deleted");
    }
}

#[test]
fn old_pre_import_files_still_parse() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("pre-import-1730000000123.db"), b"x").unwrap();
    let listed = list(dir.path()).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].kind, Kind::PreImport);
    assert_eq!(listed[0].created_at_ms, 1_730_000_000_123);
    // And a missing folder is simply empty.
    assert!(list(&dir.path().join("nope")).unwrap().is_empty());
}

#[test]
fn clean_temps_removes_only_tmp_leftovers() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("daily-5.db.tmp"), b"half").unwrap();
    std::fs::write(dir.path().join("daily-6.db"), b"whole").unwrap();
    std::fs::write(dir.path().join("mine.tmp"), b"not ours").unwrap();
    clean_temps(dir.path());
    assert_eq!(names(dir.path()), ["daily-6.db", "mine.tmp"]);
}

#[test]
fn list_is_newest_first_across_kinds() {
    let dir = TempDir::new().unwrap();
    let db = make_db(dir.path());
    let backups = dir.path().join("backups");
    create(&db, &backups, Kind::Daily, 10).unwrap();
    create(&db, &backups, Kind::Manual, 30).unwrap();
    create(&db, &backups, Kind::PreImport, 20).unwrap();
    let order: Vec<u64> = list(&backups).unwrap().iter().map(|b| b.created_at_ms).collect();
    assert_eq!(order, vec![30, 20, 10]);
}

#[test]
fn kind_names_round_trip() {
    for k in [Kind::Daily, Kind::Manual, Kind::PreDelete, Kind::PreImport, Kind::PreRestore, Kind::PreUpgrade] {
        assert_eq!(Kind::parse(k.as_str()), Some(k));
    }
    assert_eq!(Kind::parse("weekly"), None);
}
