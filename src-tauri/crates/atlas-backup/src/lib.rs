//! Atlas's backups of its own database.
//!
//! A backup is a complete, consistent copy of `atlas.db` in the `backups` folder, named
//! `<kind>-<epoch milliseconds>.db`. It is written under a temporary name and renamed when
//! finished, so a crash or a restart half-way never leaves something that looks like a real
//! backup. Each kind belongs to a "pile" with its own limit: when a pile is over its limit
//! the oldest copies in that pile go, and nothing else in the folder is ever touched.

use rusqlite::{Connection, OpenFlags};
use std::fmt;
use std::path::Path;
use std::time::Duration;

/// Why a backup was made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Daily,
    Manual,
    PreDelete,
    PreImport,
    PreRestore,
    PreUpgrade,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Daily => "daily",
            Kind::Manual => "manual",
            Kind::PreDelete => "pre-delete",
            Kind::PreImport => "pre-import",
            Kind::PreRestore => "pre-restore",
            Kind::PreUpgrade => "pre-upgrade",
        }
    }

    pub fn parse(s: &str) -> Option<Kind> {
        [
            Kind::Daily,
            Kind::Manual,
            Kind::PreDelete,
            Kind::PreImport,
            Kind::PreRestore,
            Kind::PreUpgrade,
        ]
        .into_iter()
        .find(|k| k.as_str() == s)
    }

    /// How many copies of this kind's pile are kept.
    pub fn limit(self) -> usize {
        match self {
            Kind::Daily => 7,
            Kind::Manual => 10,
            Kind::PreDelete | Kind::PreImport | Kind::PreRestore => 10,
            Kind::PreUpgrade => 3,
        }
    }

    /// Kinds with the same pile share one limit.
    fn pile(self) -> u8 {
        match self {
            Kind::Daily => 0,
            Kind::Manual => 1,
            Kind::PreDelete | Kind::PreImport | Kind::PreRestore => 2,
            Kind::PreUpgrade => 3,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupInfo {
    pub name: String,
    pub kind: Kind,
    pub created_at_ms: u64,
    pub size_bytes: u64,
}

#[derive(Debug)]
pub enum Error {
    /// The disk, the folder or the database could not be read or written.
    Io(String),
    /// The request itself was refused: a bad name, an unusable or too-new backup.
    Invalid(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Io(m) | Error::Invalid(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e.to_string())
    }
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Io(e.to_string())
    }
}

const TEMP_SUFFIX: &str = ".tmp";

/// `daily-1700000000000.db` → (Daily, 1700000000000). None for anything that is not a backup name.
fn parse_name(name: &str) -> Option<(Kind, u64)> {
    let stem = name.strip_suffix(".db")?;
    let (kind, digits) = stem.rsplit_once('-')?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((Kind::parse(kind)?, digits.parse().ok()?))
}

/// Writes a consistent copy of the database at `db_path` into `dir`, then tidies that kind's pile.
///
/// The copy is made through a second connection, so the app's own connection is never held up
/// (the database is in WAL mode: a reader does not block the writer).
pub fn create(db_path: &Path, dir: &Path, kind: Kind, now_ms: u64) -> Result<BackupInfo, Error> {
    if !db_path.is_file() {
        return Err(Error::Io(format!("{} does not exist", db_path.display())));
    }
    std::fs::create_dir_all(dir)?;
    let mut stamp = now_ms;
    let (name, final_path) = loop {
        let name = format!("{}-{stamp}.db", kind.as_str());
        let path = dir.join(&name);
        if !path.exists() {
            break (name, path);
        }
        stamp += 1;
    };
    let tmp = dir.join(format!("{name}{TEMP_SUFFIX}"));
    let _ = std::fs::remove_file(&tmp);

    let written = (|| -> Result<(), Error> {
        let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        let target = tmp
            .to_str()
            .ok_or_else(|| Error::Invalid("backup path is not valid text".into()))?;
        conn.execute("VACUUM INTO ?1", [target])?;
        Ok(())
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(e) = std::fs::rename(&tmp, &final_path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    let size_bytes = std::fs::metadata(&final_path)?.len();
    // A failure to tidy must not fail a backup that succeeded.
    let _ = prune(dir, kind);
    Ok(BackupInfo { name, kind, created_at_ms: stamp, size_bytes })
}

/// Every backup in `dir`, newest first. Files that are not backups are ignored.
pub fn list(dir: &Path) -> Result<Vec<BackupInfo>, Error> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((kind, created_at_ms)) = parse_name(&name) else { continue };
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        out.push(BackupInfo { name, kind, created_at_ms, size_bytes: meta.len() });
    }
    out.sort_by(|a, b| (b.created_at_ms, &b.name).cmp(&(a.created_at_ms, &a.name)));
    Ok(out)
}

fn prune(dir: &Path, kind: Kind) -> Result<(), Error> {
    let same_pile: Vec<BackupInfo> =
        list(dir)?.into_iter().filter(|b| b.kind.pile() == kind.pile()).collect();
    for old in same_pile.into_iter().skip(kind.limit()) {
        let _ = std::fs::remove_file(dir.join(old.name));
    }
    Ok(())
}

/// Removes half-written backups (`<backup name>.tmp`) left by a crash. Touches nothing else.
pub fn clean_temps(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_ours = name
            .strip_suffix(TEMP_SUFFIX)
            .is_some_and(|stem| parse_name(stem).is_some());
        if is_ours && entry.file_type().is_ok_and(|t| t.is_file()) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}
