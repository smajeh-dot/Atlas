//! Helpers for testing against the real Anki packages in tests/fixtures/anki.
#![allow(dead_code)]

use std::io::Write;
use std::path::{Path, PathBuf};

use anki_package::{prepare, ImportError, Prepared};
use rusqlite::Connection;
use serde_json::Value;
use tempfile::TempDir;

pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/fixtures/anki")
        .join(name)
}

/// What Anki's own library read from the package (see the fixtures README).
pub fn expected(name: &str) -> Value {
    let text = std::fs::read_to_string(fixture(&format!("{name}.expected.json"))).unwrap();
    serde_json::from_str(&text).unwrap()
}

pub fn prepare_fixture(name: &str) -> (TempDir, Prepared) {
    let work = TempDir::new().unwrap();
    let prepared = prepare(&fixture(&format!("{name}.apkg")), work.path())
        .unwrap_or_else(|e| panic!("{name}: {e}"));
    (work, prepared)
}

pub fn prepare_bytes(bytes: &[u8]) -> Result<(TempDir, Prepared), ImportError> {
    let work = TempDir::new().unwrap();
    let apkg = work.path().join("input.apkg");
    std::fs::write(&apkg, bytes).unwrap();
    let out = work.path().join("out");
    std::fs::create_dir(&out).unwrap();
    prepare(&apkg, &out).map(|p| (work, p))
}

/// Builds a zip in memory from (entry name, bytes) pairs, stored uncompressed.
pub fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, data) in entries {
            z.start_file(*name, opts).unwrap();
            z.write_all(data).unwrap();
        }
        z.finish().unwrap();
    }
    buf.into_inner()
}

pub fn open(prepared: &Prepared) -> Connection {
    Connection::open(&prepared.staging_path).unwrap()
}

pub fn meta(conn: &Connection, key: &str) -> String {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
        .unwrap_or_else(|_| panic!("meta {key} missing"))
}

/// Every row of a query as JSON values, for comparing against expected.json.
pub fn rows(conn: &Connection, sql: &str) -> Vec<Vec<Value>> {
    let mut stmt = conn.prepare(sql).unwrap();
    let n = stmt.column_count();
    let mut out = Vec::new();
    let mut rows = stmt.query([]).unwrap();
    while let Some(r) = rows.next().unwrap() {
        out.push(
            (0..n)
                .map(|i| match r.get_ref(i).unwrap() {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(v) => Value::from(v),
                    rusqlite::types::ValueRef::Real(f) => Value::from(f),
                    rusqlite::types::ValueRef::Text(t) => {
                        Value::from(String::from_utf8(t.to_vec()).unwrap())
                    }
                    rusqlite::types::ValueRef::Blob(_) => panic!("staging must not contain blobs"),
                })
                .collect(),
        );
    }
    out
}

pub fn json(text: &Value) -> Value {
    serde_json::from_str(text.as_str().unwrap()).unwrap()
}
