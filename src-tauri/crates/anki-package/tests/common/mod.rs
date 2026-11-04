//! Helpers for testing against the real Anki packages in tests/fixtures/anki.
#![allow(dead_code)]

use std::io::Write;
use std::path::{Path, PathBuf};

use anki_package::{prepare, prepare_with, ImportError, Options, Prepared};
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

pub fn prepare_bytes_with(
    bytes: &[u8],
    options: &Options,
) -> Result<(TempDir, Prepared), ImportError> {
    let work = TempDir::new().unwrap();
    let apkg = work.path().join("input.apkg");
    std::fs::write(&apkg, bytes).unwrap();
    let out = work.path().join("out");
    std::fs::create_dir(&out).unwrap();
    prepare_with(&apkg, &out, options).map(|p| (work, p))
}

/// Like `zip_of`, with a chosen compression method and zip64 headers on request.
pub fn zip_with(entries: &[(&str, &[u8])], method: zip::CompressionMethod, zip64: bool) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(method)
            .large_file(zip64);
        for (name, data) in entries {
            z.start_file(*name, opts).unwrap();
            z.write_all(data).unwrap();
        }
        z.finish().unwrap();
    }
    buf.into_inner()
}

/// Every entry of a fixture, so tests can rebuild it with changes.
pub fn fixture_entries(name: &str) -> Vec<(String, Vec<u8>)> {
    let bytes = std::fs::read(fixture(name)).unwrap();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    (0..zip.len())
        .map(|i| {
            let mut e = zip.by_index(i).unwrap();
            let name = e.name().unwrap().into_owned();
            let mut data = Vec::new();
            std::io::Read::read_to_end(&mut e, &mut data).unwrap();
            (name, data)
        })
        .collect()
}

pub fn as_refs(entries: &[(String, Vec<u8>)]) -> Vec<(&str, &[u8])> {
    entries
        .iter()
        .map(|(n, d)| (n.as_str(), d.as_slice()))
        .collect()
}

/// Rewrites the uncompressed size an entry declares, in both its local and
/// central headers, without touching the data: a zip that lies.
pub fn set_declared_size(bytes: &mut [u8], entry: &str, size: u32) {
    let name = entry.as_bytes();
    let u16_at = |b: &[u8], i: usize| u16::from_le_bytes([b[i], b[i + 1]]) as usize;
    let mut patched = 0;
    let mut i = 0;
    while i + 46 <= bytes.len() {
        let sig = &bytes[i..i + 4];
        if sig == b"PK\x03\x04" {
            let n = u16_at(bytes, i + 26);
            if &bytes[i + 30..i + 30 + n] == name {
                bytes[i + 22..i + 26].copy_from_slice(&size.to_le_bytes());
                patched += 1;
            }
        } else if sig == b"PK\x01\x02" {
            let n = u16_at(bytes, i + 28);
            if &bytes[i + 46..i + 46 + n] == name {
                bytes[i + 24..i + 28].copy_from_slice(&size.to_le_bytes());
                patched += 1;
            }
        }
        i += 1;
    }
    assert_eq!(
        patched, 2,
        "expected one local and one central header for {entry}"
    );
}

/// Every file under `dir`, as forward-slash paths relative to it.
pub fn files_under(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                stack.push(p);
            } else {
                let rel = p
                    .strip_prefix(dir)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(rel);
            }
        }
    }
    out.sort();
    out
}
