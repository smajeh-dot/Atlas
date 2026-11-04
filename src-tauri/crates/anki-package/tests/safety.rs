//! A hostile or broken package must not write outside the work folder,
//! exhaust disk or memory, or crash. One test per rule.

mod common;

use anki_package::{ImportError, Limits, Options};
use common::*;
use rusqlite::Connection;
use zip::CompressionMethod::{Deflated, Stored};

/// The real collection from a fixture, so hostile tests only vary what they test.
fn collection() -> Vec<u8> {
    fixture_entries("rich-legacy2.apkg")
        .into_iter()
        .find(|(n, _)| n == "collection.anki21")
        .unwrap()
        .1
}

fn with_limits(change: impl FnOnce(&mut Limits)) -> Options {
    let mut options = Options::default();
    change(&mut options.limits);
    options
}

fn media_rows(db: &Connection) -> Vec<(String, String)> {
    let mut stmt = db
        .prepare("SELECT name, original_name FROM media ORDER BY staged_path")
        .unwrap();
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    rows.map(Result::unwrap).collect()
}

fn too_large(result: Result<impl Sized, ImportError>) -> String {
    match result {
        Err(ImportError::TooLarge(detail)) => detail,
        Err(e) => panic!("expected TooLarge, got {e:?}"),
        Ok(_) => panic!("expected TooLarge, but the package was accepted"),
    }
}

// --- Paths -----------------------------------------------------------------

#[test]
fn entry_and_media_names_never_choose_where_files_are_written() {
    let col = collection();
    let manifest = br#"{"0": "../../escaped.png", "1": "..\\..\\escaped2.png", "2": "C:\\Windows\\evil.png", "3": "/etc/evil.png", "4": "\\\\server\\share\\x.png"}"#;
    let bytes = zip_of(&[
        ("collection.anki21", &col),
        ("media", manifest),
        ("0", b"zero"),
        ("1", b"one"),
        ("2", b"two"),
        ("3", b"three"),
        ("4", b"four"),
        ("../outside.txt", b"x"),
        ("/absolute.txt", b"x"),
        ("C:\\drive.txt", b"x"),
    ]);
    let (work, prepared) = prepare_bytes(&bytes).unwrap();

    // Only the input and the work folder exist beside each other...
    let top: Vec<String> = std::fs::read_dir(work.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(top.len(), 2, "{top:?}");
    // ...and inside the work folder there is nothing but staging and numbered media.
    let files = files_under(&work.path().join("out"));
    assert_eq!(
        files,
        [
            "media/0",
            "media/1",
            "media/2",
            "media/3",
            "media/4",
            "staging.db"
        ]
    );

    for (name, original) in media_rows(&open(&prepared)) {
        assert!(
            !name.contains(['/', '\\', ':']) && !name.starts_with('.'),
            "{original:?} became {name:?}"
        );
    }
}

#[test]
fn unsafe_media_names_are_made_safe_and_the_original_is_kept() {
    let col = collection();
    let long = format!("{}.png", "n".repeat(300));
    let manifest = serde_json::json!({
        "0": "CON.png", "1": "a<b>.png", "2": "trailing. ", "3": ".hidden.png", "4": "", "5": long, "6": "fine.png"
    })
    .to_string();
    let files: Vec<(String, Vec<u8>)> = (0..7)
        .map(|i| (i.to_string(), vec![b'a' + i as u8; 3]))
        .collect();
    let mut entries: Vec<(&str, &[u8])> =
        vec![("collection.anki21", &col), ("media", manifest.as_bytes())];
    entries.extend(as_refs(&files));
    let (_work, prepared) = prepare_bytes(&zip_of(&entries)).unwrap();

    let rows = media_rows(&open(&prepared));
    let got: Vec<(&str, &str)> = rows.iter().map(|(n, o)| (n.as_str(), o.as_str())).collect();
    assert_eq!(got[0], ("_CON.png", "CON.png"));
    assert_eq!(got[1], ("a_b_.png", "a<b>.png"));
    assert_eq!(got[2], ("trailing", "trailing. "));
    assert_eq!(got[3], ("_hidden.png", ".hidden.png"));
    assert!(!got[4].0.is_empty() && got[4].1.is_empty());
    assert!(got[5].0.len() <= 200 && got[5].0.ends_with(".png") && got[5].1 == long);
    assert_eq!(got[6], ("fine.png", "fine.png"));
}

#[test]
fn names_that_collide_on_windows_get_distinct_names() {
    let col = collection();
    let manifest = serde_json::json!({
        "0": "Diagram.png", "1": "diagram.png",          // differ only by case
        "2": "café.png", "3": "cafe\u{301}.png",         // NFC and NFD spellings
        "4": "same.png", "5": "same.png",                // listed twice, same bytes
    })
    .to_string();
    let bytes = zip_of(&[
        ("collection.anki21", &col),
        ("media", manifest.as_bytes()),
        ("0", b"upper"),
        ("1", b"lower"),
        ("2", b"composed"),
        ("3", b"decomposed"),
        ("4", b"twin"),
        ("5", b"twin"),
    ]);
    let (_work, prepared) = prepare_bytes(&bytes).unwrap();
    let rows = media_rows(&open(&prepared));
    assert_eq!(rows.len(), 6);

    let keys: std::collections::HashSet<String> =
        rows.iter().map(|(n, _)| n.to_lowercase()).collect();
    assert_eq!(
        keys.len(),
        6,
        "names must be unique ignoring case: {rows:?}"
    );
    // The first of each pair keeps its name; the second gets a content hash.
    assert_eq!(rows[0].0, "Diagram.png");
    assert!(
        rows[1].0.starts_with("diagram-") && rows[1].0.ends_with(".png"),
        "{rows:?}"
    );
    assert_eq!(rows[2].0, "café.png");
    assert!(rows[3].0.starts_with("café-"), "{rows:?}");
    assert_eq!(rows[3].1, "cafe\u{301}.png");
}

// --- Limits ----------------------------------------------------------------

#[test]
fn default_limits_accept_real_packages_and_are_not_unbounded() {
    let l = Limits::default();
    assert!(
        l.max_package_bytes < u64::MAX
            && l.max_entry_bytes < u64::MAX
            && l.max_total_bytes < u64::MAX
    );
    assert!(l.max_entries < usize::MAX && l.max_ratio <= 1_000 && l.reserve_bytes > 0);
    for name in ["rich-legacy1", "rich-legacy2", "fsrs-legacy2"] {
        prepare_fixture(name);
    }
}

#[test]
fn too_many_entries_is_refused_before_reading_any() {
    let bytes = std::fs::read(fixture("rich-legacy2.apkg")).unwrap();
    too_large(prepare_bytes_with(
        &bytes,
        &with_limits(|l| l.max_entries = 5),
    ));
}

#[test]
fn an_oversized_package_file_is_refused() {
    let bytes = std::fs::read(fixture("rich-legacy2.apkg")).unwrap();
    too_large(prepare_bytes_with(
        &bytes,
        &with_limits(|l| l.max_package_bytes = 1_000),
    ));
}

#[test]
fn an_oversized_entry_is_refused() {
    let col = collection();
    let big = vec![7u8; 300_000];
    let bytes = zip_of(&[
        ("collection.anki21", &col),
        ("media", br#"{"0": "big.png"}"#),
        ("0", &big),
    ]);
    too_large(prepare_bytes_with(
        &bytes,
        &with_limits(|l| l.max_entry_bytes = 200_000),
    ));
}

#[test]
fn an_oversized_collection_is_refused() {
    let bytes = std::fs::read(fixture("rich-legacy2.apkg")).unwrap();
    too_large(prepare_bytes_with(
        &bytes,
        &with_limits(|l| l.max_entry_bytes = 10_000),
    ));
}

#[test]
fn the_total_of_all_entries_is_capped() {
    let col = collection();
    let chunk = vec![1u8; 100_000];
    let bytes = zip_of(&[
        ("collection.anki21", &col),
        ("media", br#"{"0": "a.png", "1": "b.png", "2": "c.png"}"#),
        ("0", &chunk),
        ("1", &chunk),
        ("2", &chunk),
    ]);
    let cap = col.len() as u64 + 250_000;
    too_large(prepare_bytes_with(
        &bytes,
        &with_limits(|l| l.max_total_bytes = cap),
    ));
}

#[test]
fn a_zip_bomb_is_stopped_by_its_compression_ratio() {
    let col = collection();
    // 64 MB of zeros deflates to about 64 KB: a 1000:1 ratio.
    let zeros = vec![0u8; 64 * 1024 * 1024];
    let bytes = zip_with(
        &[
            ("collection.anki21", &col),
            ("media", br#"{"0": "bomb.png"}"#),
            ("0", &zeros),
        ],
        Deflated,
        false,
    );
    assert!(bytes.len() < 1024 * 1024);
    let detail = too_large(prepare_bytes_with(&bytes, &Options::default()));
    assert!(detail.contains("ratio"), "{detail}");
}

#[test]
fn declared_sizes_are_not_trusted() {
    let col = collection();
    let data = vec![3u8; 2_000_000];
    let mut bytes = zip_with(
        &[
            ("collection.anki21", &col),
            ("media", br#"{"0": "liar.png"}"#),
            ("0", &data),
        ],
        Deflated,
        false,
    );
    set_declared_size(&mut bytes, "0", 10);
    let options = with_limits(|l| {
        l.max_entry_bytes = 1_000_000;
        l.max_ratio = u64::MAX;
    });
    match prepare_bytes_with(&bytes, &options) {
        // Either the cap catches the extra bytes or the zip reader rejects the
        // mismatch; what matters is that 2 MB never lands on disk.
        Err(ImportError::TooLarge(_)) | Err(ImportError::Corrupt(_)) => {}
        other => panic!("a lying size header was accepted: {:?}", other.map(|_| ())),
    }
}

#[test]
fn zip64_packages_are_read() {
    let entries = fixture_entries("rich-legacy2.apkg");
    let bytes = zip_with(&as_refs(&entries), Stored, true);
    let (_a, zip64) = prepare_bytes(&bytes).unwrap();
    let (_b, plain) = prepare_fixture("rich-legacy2");
    for sql in [
        "SELECT * FROM note ORDER BY id",
        "SELECT * FROM card ORDER BY id",
        "SELECT name, sha1 FROM media ORDER BY name",
    ] {
        assert_eq!(rows(&open(&zip64), sql), rows(&open(&plain), sql), "{sql}");
    }
}

// --- Disk space ------------------------------------------------------------

#[test]
fn not_enough_disk_space_is_refused_before_extracting() {
    let bytes = std::fs::read(fixture("rich-legacy2.apkg")).unwrap();
    let options = Options {
        free_space: |_| Ok(1_000),
        ..Options::default()
    };
    let err = prepare_bytes_with(&bytes, &options)
        .map(|_| ())
        .unwrap_err();
    assert!(
        matches!(err, ImportError::NotEnoughDiskSpace { .. }),
        "{err:?}"
    );
}

#[test]
fn free_space_can_be_measured() {
    let dir = tempfile::TempDir::new().unwrap();
    let free = anki_package::available_space(dir.path()).unwrap();
    assert!(free > 0 && free < u64::MAX);
}
