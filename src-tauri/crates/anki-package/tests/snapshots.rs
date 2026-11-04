//! The staging databases committed under tests/fixtures/anki/staged/ are what
//! the TypeScript importer's tests read. This keeps them identical in content
//! to what this crate produces now, so both sides test one contract.
//!
//! To refresh them after changing the reader (from src-tauri):
//!     UPDATE_SNAPSHOTS=1 cargo test -p anki-package --test snapshots

mod common;

use common::*;

const STAGED: [&str; 3] = ["rich-modern", "rich-modern-nosched", "fsrs-modern"];

fn tables(db: &rusqlite::Connection) -> Vec<String> {
    let mut stmt = db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
        .unwrap();
    let names = stmt.query_map([], |r| r.get(0)).unwrap();
    names.map(Result::unwrap).collect()
}

#[test]
fn committed_staging_snapshots_match_the_reader() {
    for name in STAGED {
        let (_work, prepared) = prepare_fixture(name);
        let snapshot = fixture(&format!("staged/{name}.staging.db"));
        if std::env::var_os("UPDATE_SNAPSHOTS").is_some() {
            std::fs::create_dir_all(snapshot.parent().unwrap()).unwrap();
            let fresh = open(&prepared);
            let _ = std::fs::remove_file(&snapshot);
            fresh
                .execute("VACUUM INTO ?1", [snapshot.to_str().unwrap()])
                .unwrap();
            continue;
        }
        assert!(snapshot.exists(), "{name}: no snapshot; see the comment at the top of this file");
        let fresh = open(&prepared);
        let committed = rusqlite::Connection::open(&snapshot).unwrap();
        assert_eq!(tables(&fresh), tables(&committed), "{name}");
        for table in tables(&fresh) {
            let sql = format!("SELECT * FROM {table} ORDER BY 1, 2");
            assert_eq!(rows(&fresh, &sql), rows(&committed, &sql), "{name}: {table} differs; refresh the snapshots");
        }
    }
}
