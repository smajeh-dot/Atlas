//! The private folder one import works in (`%APPDATA%\Atlas\tmp\import-…`).
//!
//! It is deleted when the import ends, however it ends. If the app is killed
//! mid-import the folder survives, so `remove_stale` clears leftovers on the
//! next launch.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const PREFIX: &str = "import-";

pub struct WorkDir {
    path: PathBuf,
}

impl WorkDir {
    /// Makes a new, empty folder inside `parent` (creating `parent` if needed).
    pub fn create_in(parent: &Path) -> io::Result<Self> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        std::fs::create_dir_all(parent)?;
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        loop {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!("{PREFIX}{}-{nanos}-{n}", std::process::id()));
            // `create_dir`, not `create_dir_all`: it fails if the folder exists,
            // so two imports can never share one.
            match std::fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        // Nothing useful can be done with a failure here; `remove_stale` will
        // try again on the next launch.
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Removes work folders left behind by an import that never finished.
/// Call only when no import is running (on launch). Touches nothing but
/// folders named `import-…` directly inside `parent`.
pub fn remove_stale(parent: &Path) -> io::Result<usize> {
    let entries = match std::fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e),
    };
    let mut removed = 0;
    for entry in entries {
        let entry = entry?;
        // `file_type` doesn't follow links, so a link named import-… is skipped
        // rather than having its target deleted.
        if entry.file_type()?.is_dir() && entry.file_name().to_string_lossy().starts_with(PREFIX) {
            std::fs::remove_dir_all(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}
