//! Files Atlas must refuse, each with a clear, friendly reason.

mod common;

use anki_package::ImportError;
use common::*;

fn refusal(bytes: &[u8]) -> ImportError {
    match prepare_bytes(bytes) {
        Ok(_) => panic!("expected the file to be refused"),
        Err(e) => e,
    }
}

fn legacy_collection_bytes() -> Vec<u8> {
    let apkg = std::fs::read(fixture("rich-legacy2.apkg")).unwrap();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(apkg)).unwrap();
    let mut out = Vec::new();
    std::io::copy(&mut zip.by_name("collection.anki21").unwrap(), &mut out).unwrap();
    out
}

#[test]
fn placeholder_only_package_is_refused_with_the_export_again_message() {
    let work = tempfile::TempDir::new().unwrap();
    let err = anki_package::prepare(&fixture("dummy-only.apkg"), work.path()).unwrap_err();
    assert!(matches!(err, ImportError::OnlyDummyCollection), "{err:?}");
    assert!(err.message().contains("Support older Anki versions"));
}

#[test]
fn placeholder_is_ignored_when_the_real_collection_is_present() {
    // rich-legacy2 carries the placeholder as collection.anki2 too.
    let (_work, prepared) = prepare_fixture("rich-legacy2");
    assert!(prepared.counts.notes > 1);
}

#[test]
fn files_that_are_not_zips_are_not_apkgs() {
    for bytes in [
        &b""[..],
        b"hello, this is a text file",
        b"SQLite format 3\0",
    ] {
        assert!(matches!(refusal(bytes), ImportError::NotAnApkg));
    }
}

#[test]
fn a_zip_without_a_collection_is_not_an_apkg() {
    let bytes = zip_of(&[("hello.txt", b"hi"), ("media", b"{}")]);
    assert!(matches!(refusal(&bytes), ImportError::NotAnApkg));
}

#[test]
fn a_damaged_zip_is_corrupt() {
    let mut bytes = std::fs::read(fixture("rich-legacy2.apkg")).unwrap();
    bytes.truncate(bytes.len() / 2);
    assert!(matches!(refusal(&bytes), ImportError::Corrupt(_)));
}

#[test]
fn unknown_package_versions_are_refused() {
    let bytes = zip_of(&[("meta", &[0x08, 0x09]), ("collection.anki21b", b"x")]);
    assert!(matches!(
        refusal(&bytes),
        ImportError::UnsupportedVersion(9)
    ));
    let bytes = zip_of(&[("meta", &[]), ("collection.anki21b", b"x")]);
    assert!(matches!(
        refusal(&bytes),
        ImportError::UnsupportedVersion(0)
    ));
}

#[test]
fn meta_naming_a_missing_collection_is_corrupt() {
    let bytes = zip_of(&[("meta", &[0x08, 0x02]), ("collection.anki2", b"x")]);
    assert!(matches!(refusal(&bytes), ImportError::Corrupt(_)));
}

#[test]
fn a_collection_that_is_not_a_database_is_corrupt() {
    let bytes = zip_of(&[(
        "collection.anki2",
        b"definitely not sqlite, just some bytes here",
    )]);
    assert!(matches!(refusal(&bytes), ImportError::Corrupt(_)));
}

#[test]
fn a_bad_media_manifest_is_corrupt() {
    let col = legacy_collection_bytes();
    for manifest in [
        &b"not json"[..],
        b"[1,2]",
        br#"{"../evil": "a.png"}"#,
        br#"{"01": "a.png"}"#,
    ] {
        let bytes = zip_of(&[("collection.anki21", &col), ("media", manifest)]);
        assert!(
            matches!(refusal(&bytes), ImportError::Corrupt(_)),
            "{}",
            String::from_utf8_lossy(manifest)
        );
    }
}

#[test]
fn missing_media_files_are_skipped_not_fatal() {
    let col = legacy_collection_bytes();
    let bytes = zip_of(&[
        ("collection.anki21", &col),
        ("media", br#"{"0": "a.png", "1": "b.png"}"#),
        ("1", b"bee"),
    ]);
    let (_work, prepared) = prepare_bytes(&bytes).unwrap();
    let db = open(&prepared);
    assert_eq!(
        rows(&db, "SELECT name, size FROM media"),
        vec![vec![serde_json::json!("b.png"), serde_json::json!(3)]]
    );
}

#[test]
fn messages_are_plain_english() {
    let all = [
        ImportError::NotAnApkg,
        ImportError::Corrupt("rusqlite: file is not a database".into()),
        ImportError::UnsupportedVersion(9),
        ImportError::OnlyDummyCollection,
        ImportError::TooLarge("zip entry".into()),
        ImportError::NotEnoughDiskSpace {
            needed: 10,
            available: 1,
        },
        ImportError::Io("os error 5".into()),
    ];
    for e in all {
        let m = e.message();
        assert!(m.ends_with('.'), "{m}");
        for jargon in ["rusqlite", "zip", "sqlite", "os error", "protobuf"] {
            assert!(!m.to_lowercase().contains(jargon), "{m}");
        }
        assert!(!e.code().is_empty());
    }
}
