//! Moves staged media into Atlas's media folder, removes it again on
//! rollback, and backs up the database before an import.
//!
//! Names arrive from the TypeScript importer, which got them from an untrusted
//! package, so every name is checked again here: only names that
//! `safe_media_name` leaves unchanged are accepted, so nothing can escape the
//! media folder or use a name Windows reserves. Files are written to a
//! temporary name, checked against their SHA-1, flushed, then renamed into
//! place, so a crash never leaves a half-written file under a real name.

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::Connection;
use sha1::{Digest, Sha1};

use crate::error::{ImportError, Result};
use crate::media::hex;
use crate::names;

const TEMP_PREFIX: &str = ".atlas-import-";

#[derive(Debug, Clone)]
pub struct InstallFile {
    /// Where the package reader staged it, relative to the work folder: `media/<digits>`.
    pub staged_path: String,
    /// The name it gets in the media folder.
    pub name: String,
    /// Expected hex SHA-1 of its bytes.
    pub sha1: String,
}

fn refuse(detail: String) -> ImportError {
    ImportError::Io(detail)
}

fn check_name(name: &str) -> Result<()> {
    if names::safe_media_name(name) != name {
        return Err(refuse(format!("refusing unsafe media name {name:?}")));
    }
    Ok(())
}

fn check_staged_path(path: &str) -> Result<()> {
    match path.strip_prefix("media/") {
        Some(n) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => Ok(()),
        _ => Err(refuse(format!("refusing staged path {path:?}"))),
    }
}

fn sha1_of(path: &Path) -> Result<String> {
    let mut f = File::open(path)?;
    let mut h = Sha1::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

fn temp_path(media_dir: &Path) -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    media_dir.join(format!(
        "{TEMP_PREFIX}{}-{}.tmp",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ))
}

/// Copies each staged file into `media_dir` under its name. A file that is
/// already there with the same bytes is left alone; one with different bytes
/// is an error, never overwritten.
pub fn install_media(work_dir: &Path, media_dir: &Path, files: &[InstallFile]) -> Result<()> {
    std::fs::create_dir_all(media_dir)?;
    for f in files {
        check_name(&f.name)?;
        check_staged_path(&f.staged_path)?;
        let dest = media_dir.join(&f.name);
        if dest.symlink_metadata().is_ok() {
            if dest.is_file() && sha1_of(&dest)? == f.sha1 {
                continue;
            }
            return Err(refuse(format!(
                "a different file named {:?} is already in the media folder",
                f.name
            )));
        }
        let src = work_dir.join(&f.staged_path);
        let tmp = temp_path(media_dir);
        let written = (|| -> Result<String> {
            let mut out =
                BufWriter::new(OpenOptions::new().write(true).create_new(true).open(&tmp)?);
            let mut input = File::open(&src)?;
            let mut h = Sha1::new();
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let n = input.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                h.update(&buf[..n]);
                out.write_all(&buf[..n])?;
            }
            let file = out
                .into_inner()
                .map_err(|e| ImportError::Io(e.to_string()))?;
            file.sync_all()?;
            Ok(hex(&h.finalize()))
        })();
        match written {
            Ok(sha) if sha == f.sha1 => {}
            Ok(sha) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(ImportError::Corrupt(format!(
                    "{} changed while importing ({sha})",
                    f.name
                )));
            }
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(e);
            }
        }
        if let Err(e) = std::fs::rename(&tmp, &dest) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }
    }
    Ok(())
}

/// Deletes media files an import added. Missing files are fine (the import
/// may have stopped before copying them).
pub fn remove_media(media_dir: &Path, names: &[String]) -> Result<()> {
    for name in names {
        check_name(name)?;
        match std::fs::remove_file(media_dir.join(name)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

/// Removes half-copied files left in the media folder by a crash.
pub fn remove_stale_media_temps(media_dir: &Path) -> Result<usize> {
    let Ok(entries) = std::fs::read_dir(media_dir) else {
        return Ok(0);
    };
    let mut removed = 0;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(TEMP_PREFIX) && name.ends_with(".tmp") && entry.file_type()?.is_file() {
            std::fs::remove_file(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Writes a consistent copy of the open database to
/// `<backups_dir>/pre-import-<stamp>.db` with `VACUUM INTO`, which works while
/// the database is in use.
pub fn backup_database(conn: &Connection, backups_dir: &Path, stamp: &str) -> Result<PathBuf> {
    if !stamp
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(refuse(format!("bad backup stamp {stamp:?}")));
    }
    std::fs::create_dir_all(backups_dir)?;
    let dest = backups_dir.join(format!("pre-import-{stamp}.db"));
    if dest.exists() {
        return Err(refuse(format!("{} already exists", dest.display())));
    }
    let text = dest
        .to_str()
        .ok_or_else(|| refuse("backup path is not valid text".into()))?;
    conn.execute("VACUUM INTO ?1", [text])
        .map_err(|e| ImportError::Io(format!("backup: {e}")))?;
    Ok(dest)
}
