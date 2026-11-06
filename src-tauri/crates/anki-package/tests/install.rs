//! Installing media into Atlas's folder and removing it on rollback.

use anki_package::{
    install_media, remove_media, remove_stale_media_temps, ImportError, InstallFile,
};
use sha1::{Digest, Sha1};
use std::path::Path;
use tempfile::TempDir;

fn sha(bytes: &[u8]) -> String {
    Sha1::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A work folder with staged files media/0, media/1, … holding `contents`.
fn staged(contents: &[&[u8]]) -> TempDir {
    let work = TempDir::new().unwrap();
    std::fs::create_dir(work.path().join("media")).unwrap();
    for (i, c) in contents.iter().enumerate() {
        std::fs::write(work.path().join("media").join(i.to_string()), c).unwrap();
    }
    work
}

fn file(i: usize, name: &str, bytes: &[u8]) -> InstallFile {
    InstallFile {
        staged_path: format!("media/{i}"),
        name: name.into(),
        sha1: sha(bytes),
    }
}

fn listing(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[test]
fn files_land_under_their_names_with_their_bytes_and_no_temp_files() {
    let work = staged(&[b"one", b"two"]);
    let media = TempDir::new().unwrap();
    install_media(
        work.path(),
        media.path(),
        &[file(0, "a.png", b"one"), file(1, "café.png", b"two")],
    )
    .unwrap();
    assert_eq!(listing(media.path()), ["a.png", "café.png"]);
    assert_eq!(
        std::fs::read(media.path().join("café.png")).unwrap(),
        b"two"
    );
}

#[test]
fn installing_the_same_file_again_is_fine() {
    let work = staged(&[b"one"]);
    let media = TempDir::new().unwrap();
    for _ in 0..2 {
        install_media(work.path(), media.path(), &[file(0, "a.png", b"one")]).unwrap();
    }
    assert_eq!(listing(media.path()), ["a.png"]);
}

#[test]
fn a_different_file_is_never_overwritten() {
    let work = staged(&[b"new"]);
    let media = TempDir::new().unwrap();
    std::fs::write(media.path().join("a.png"), b"old").unwrap();
    assert!(install_media(work.path(), media.path(), &[file(0, "a.png", b"new")]).is_err());
    assert_eq!(std::fs::read(media.path().join("a.png")).unwrap(), b"old");
    assert_eq!(listing(media.path()), ["a.png"]);
}

#[test]
fn unsafe_names_and_paths_are_refused_before_anything_is_written() {
    let work = staged(&[b"x"]);
    let media = TempDir::new().unwrap();
    for name in [
        "../escape.png",
        "..\\escape.png",
        "CON.png",
        "a:b.png",
        ".hidden",
        "trailing.",
        "",
    ] {
        let err = install_media(work.path(), media.path(), &[file(0, name, b"x")]).unwrap_err();
        assert!(matches!(err, ImportError::Io(_)), "{name:?}");
    }
    for staged_path in [
        "../../etc/passwd",
        "media/../x",
        "media/",
        "other/0",
        "media/0/..",
        "/abs",
    ] {
        let f = InstallFile {
            staged_path: staged_path.into(),
            name: "ok.png".into(),
            sha1: sha(b"x"),
        };
        assert!(
            install_media(work.path(), media.path(), &[f]).is_err(),
            "{staged_path:?}"
        );
    }
    assert!(listing(media.path()).is_empty());
    assert!(listing(media.path().parent().unwrap())
        .iter()
        .all(|n| n != "escape.png"));
}

#[test]
fn bytes_that_do_not_match_their_hash_are_not_installed() {
    let work = staged(&[b"tampered"]);
    let media = TempDir::new().unwrap();
    let f = InstallFile {
        staged_path: "media/0".into(),
        name: "a.png".into(),
        sha1: sha(b"original"),
    };
    assert!(matches!(
        install_media(work.path(), media.path(), &[f]),
        Err(ImportError::Corrupt(_))
    ));
    assert!(
        listing(media.path()).is_empty(),
        "no file and no temp file left behind"
    );
}

#[test]
fn removing_deletes_only_what_is_named_and_ignores_missing_files() {
    let media = TempDir::new().unwrap();
    for n in ["a.png", "b.png", "keep.png"] {
        std::fs::write(media.path().join(n), n).unwrap();
    }
    remove_media(
        media.path(),
        &["a.png".into(), "b.png".into(), "never-there.png".into()],
    )
    .unwrap();
    assert_eq!(listing(media.path()), ["keep.png"]);
    assert!(remove_media(media.path(), &["../keep.png".into()]).is_err());
}

#[test]
fn half_copied_files_from_a_crash_are_cleared() {
    let media = TempDir::new().unwrap();
    std::fs::write(media.path().join(".atlas-import-12-0.tmp"), b"half").unwrap();
    std::fs::write(media.path().join("real.png"), b"x").unwrap();
    assert_eq!(remove_stale_media_temps(media.path()).unwrap(), 1);
    assert_eq!(listing(media.path()), ["real.png"]);
}
