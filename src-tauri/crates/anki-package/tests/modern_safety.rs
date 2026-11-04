//! Hostile and broken modern (zstd + protobuf) packages are refused cleanly.

mod common;

use std::io::Read;

use anki_package::{ImportError, Options};
use common::*;
use ruzstd::encoding::{compress_to_vec, CompressionLevel};

fn zstd(bytes: &[u8]) -> Vec<u8> {
    compress_to_vec(bytes, CompressionLevel::Fastest)
}

fn unzstd(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    ruzstd::decoding::StreamingDecoder::new(bytes)
        .unwrap()
        .read_to_end(&mut out)
        .unwrap();
    out
}

/// rich-modern.apkg with some entries replaced.
fn modern_with(replace: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut entries = fixture_entries("rich-modern.apkg");
    for (name, data) in replace {
        let slot = entries.iter_mut().find(|(n, _)| n == name);
        match slot {
            Some(slot) => slot.1 = data.clone(),
            None => entries.push((name.to_string(), data.clone())),
        }
    }
    zip_of(&as_refs(&entries))
}

fn refusal(bytes: &[u8]) -> ImportError {
    match prepare_bytes_with(bytes, &Options::default()) {
        Ok(_) => panic!("expected the package to be refused"),
        Err(e) => e,
    }
}

fn real_collection() -> Vec<u8> {
    let entries = fixture_entries("rich-modern.apkg");
    unzstd(
        &entries
            .iter()
            .find(|(n, _)| n == "collection.anki21b")
            .unwrap()
            .1,
    )
}

#[test]
fn a_zstd_bomb_in_the_collection_is_stopped() {
    let bomb = zstd(&vec![0u8; 64 * 1024 * 1024]);
    assert!(bomb.len() < 1024 * 1024);
    match refusal(&modern_with(&[("collection.anki21b", bomb)])) {
        ImportError::TooLarge(d) => assert!(d.contains("ratio"), "{d}"),
        e => panic!("{e:?}"),
    }
}

#[test]
fn a_zstd_bomb_in_a_media_file_is_stopped() {
    let bomb = zstd(&vec![0u8; 64 * 1024 * 1024]);
    match refusal(&modern_with(&[("0", bomb)])) {
        ImportError::TooLarge(d) => assert!(d.contains("ratio"), "{d}"),
        e => panic!("{e:?}"),
    }
}

#[test]
fn a_huge_zstd_window_is_refused_before_any_memory_is_allocated() {
    // Magic, a frame descriptor with no content size, and a window
    // descriptor asking for 2^41 bytes (2 TiB).
    let frame = vec![0x28, 0xb5, 0x2f, 0xfd, 0x00, 0xf8, 0x00, 0x00, 0x00];
    match refusal(&modern_with(&[("collection.anki21b", frame.clone())])) {
        ImportError::TooLarge(d) => assert!(d.contains("window"), "{d}"),
        e => panic!("{e:?}"),
    }
    match refusal(&modern_with(&[("0", frame)])) {
        ImportError::TooLarge(d) => assert!(d.contains("window"), "{d}"),
        e => panic!("{e:?}"),
    }
}

#[test]
fn a_collection_that_is_not_zstd_is_corrupt() {
    let raw = real_collection();
    assert!(matches!(
        refusal(&modern_with(&[("collection.anki21b", raw)])),
        ImportError::Corrupt(_)
    ));
}

#[test]
fn a_truncated_zstd_collection_is_corrupt() {
    let packed = zstd(&real_collection());
    let half = packed[..packed.len() / 2].to_vec();
    assert!(matches!(
        refusal(&modern_with(&[("collection.anki21b", half)])),
        ImportError::Corrupt(_)
    ));
}

#[test]
fn garbage_protobuf_in_a_note_type_is_corrupt_not_a_panic() {
    let dir = tempfile::TempDir::new().unwrap();
    let path = dir.path().join("c.db");
    std::fs::write(&path, real_collection()).unwrap();
    {
        let db = rusqlite::Connection::open(&path).unwrap();
        db.create_collation("unicase", |a: &str, b: &str| {
            a.to_lowercase().cmp(&b.to_lowercase())
        })
        .unwrap();
        // Field 1, length-delimited, claims 5 bytes but has none.
        db.execute("UPDATE notetypes SET config = x'0a05'", [])
            .unwrap();
    }
    let broken = zstd(&std::fs::read(&path).unwrap());
    match refusal(&modern_with(&[("collection.anki21b", broken)])) {
        ImportError::Corrupt(d) => assert!(d.contains("protobuf"), "{d}"),
        e => panic!("{e:?}"),
    }
}

#[test]
fn a_broken_media_manifest_is_corrupt() {
    for manifest in [b"not zstd at all".to_vec(), zstd(&[0x0a, 0x05, b'a', b'b'])] {
        assert!(matches!(
            refusal(&modern_with(&[("media", manifest)])),
            ImportError::Corrupt(_)
        ));
    }
}

#[test]
fn legacy_zip_filename_says_which_entry_holds_the_file() {
    // MediaEntries { entries: [MediaEntry { name: "x.png", size: 5, legacy_zip_filename: 7 }] }
    let mut entry = vec![0x0a, 0x05];
    entry.extend(b"x.png");
    entry.extend([0x10, 0x05, 0xf8, 0x0f, 0x07]); // size = 5; field 255 = 7
    let mut manifest = vec![0x0a, entry.len() as u8];
    manifest.extend(&entry);
    let (_work, prepared) = prepare_bytes(&modern_with(&[
        ("media", zstd(&manifest)),
        ("7", zstd(b"seven")),
    ]))
    .unwrap();
    let got = rows(
        &open(&prepared),
        "SELECT name, size, staged_path FROM media",
    );
    assert_eq!(
        got,
        vec![vec![
            serde_json::json!("x.png"),
            serde_json::json!(5),
            serde_json::json!("media/7")
        ]]
    );
}
