//! The work folder is private to one import and never outlives it.

use anki_package::{remove_stale, WorkDir};

#[test]
fn each_import_gets_its_own_new_folder() {
    let parent = tempfile::TempDir::new().unwrap();
    let tmp = parent.path().join("tmp");
    let a = WorkDir::create_in(&tmp).unwrap();
    let b = WorkDir::create_in(&tmp).unwrap();
    assert_ne!(a.path(), b.path());
    assert!(a.path().is_dir() && b.path().is_dir());
    assert!(a.path().starts_with(&tmp));
    assert_eq!(std::fs::read_dir(a.path()).unwrap().count(), 0);
}

#[test]
fn the_folder_and_everything_in_it_go_when_the_import_ends() {
    let parent = tempfile::TempDir::new().unwrap();
    let path = {
        let work = WorkDir::create_in(parent.path()).unwrap();
        std::fs::create_dir(work.path().join("media")).unwrap();
        std::fs::write(work.path().join("media").join("0"), b"x").unwrap();
        work.path().to_path_buf()
    };
    assert!(!path.exists());
}

#[test]
fn leftovers_from_a_crash_are_removed_and_nothing_else() {
    let parent = tempfile::TempDir::new().unwrap();
    let p = parent.path();
    for name in ["import-1-2-3", "import-old"] {
        std::fs::create_dir(p.join(name)).unwrap();
        std::fs::write(p.join(name).join("staging.db"), b"x").unwrap();
    }
    std::fs::create_dir(p.join("keep-me")).unwrap();
    std::fs::write(p.join("import-not-a-folder"), b"x").unwrap();

    assert_eq!(remove_stale(p).unwrap(), 2);
    let mut left: Vec<String> = std::fs::read_dir(p)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    left.sort();
    assert_eq!(left, ["import-not-a-folder", "keep-me"]);
}

#[test]
fn removing_leftovers_from_a_missing_folder_is_fine() {
    let parent = tempfile::TempDir::new().unwrap();
    assert_eq!(remove_stale(&parent.path().join("never-made")).unwrap(), 0);
}
