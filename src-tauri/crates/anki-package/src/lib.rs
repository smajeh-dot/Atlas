//! Reads Anki `.apkg` files into Atlas's staging database.
//!
//! This crate owns everything that touches the untrusted package bytes. It
//! decodes the package into a plain SQLite file (`staging.sql`) plus extracted
//! media, and makes no decisions about how to import; the TypeScript importer
//! reads the staging file and does the mapping. It deliberately has no Tauri
//! dependency so it builds and tests on any machine.

mod error;
mod format;
mod legacy;
mod media;
mod proto;
mod staging;

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};

pub use error::{ImportError, Result};
pub use format::SourceFormat;
pub use legacy::Counts;
pub use staging::{STAGING_SCHEMA, STAGING_VERSION};

/// What `prepare` left in the work folder.
#[derive(Debug)]
pub struct Prepared {
    /// `<work_dir>/staging.db`.
    pub staging_path: PathBuf,
    pub format: SourceFormat,
    pub counts: Counts,
}

/// Decodes `apkg` into `<work_dir>/staging.db` and `<work_dir>/media/`.
///
/// `work_dir` must be an empty folder the caller owns. On error it may hold
/// partial output, and the caller should delete the whole folder.
pub fn prepare(apkg: &Path, work_dir: &Path) -> Result<Prepared> {
    let source_sha256 = sha256_file(apkg)?;
    let mut zip = open_zip(apkg)?;
    let layout = format::detect(&mut zip)?;
    if layout.format == SourceFormat::Modern {
        // Read in a later version of this crate; until then, refuse clearly.
        return Err(ImportError::UnsupportedVersion(3));
    }

    let collection_path = work_dir.join("collection.sqlite");
    {
        let mut entry = zip
            .by_name(layout.format.collection_entry())
            .map_err(|e| ImportError::Corrupt(format!("collection: {e}")))?;
        media::copy_hashing(&mut entry, &collection_path)?;
    }

    let staging_path = work_dir.join("staging.db");
    let st = staging::Staging::create(&staging_path)?;
    st.meta("source_format", layout.format.as_str())?;
    st.meta(
        "package_version",
        &layout
            .package_version
            .map(|v| v.to_string())
            .unwrap_or_default(),
    )?;
    st.meta("collection_entry", layout.format.collection_entry())?;
    st.meta("source_sha256", &source_sha256)?;

    let mut counts = {
        let src = open_collection(&collection_path)?;
        legacy::read(&src, &st)?
    };
    counts.media = media::extract_legacy(&mut zip, work_dir, &st)?;
    st.finish()?;
    // The decoded copy is no longer needed and can be large.
    std::fs::remove_file(&collection_path)?;

    Ok(Prepared {
        staging_path,
        format: layout.format,
        counts,
    })
}

fn open_zip(apkg: &Path) -> Result<zip::ZipArchive<BufReader<File>>> {
    let mut magic = [0u8; 4];
    let looks_like_zip =
        File::open(apkg)?.read_exact(&mut magic).is_ok() && magic == *b"PK\x03\x04";
    zip::ZipArchive::new(BufReader::new(File::open(apkg)?)).map_err(|e| match e {
        zip::result::ZipError::Io(io) => ImportError::Io(io.to_string()),
        // Starts like a zip but won't open: damaged rather than the wrong file.
        other if looks_like_zip => ImportError::Corrupt(format!("zip: {other}")),
        _ => ImportError::NotAnApkg,
    })
}

/// Opens an extracted collection as read-only and untrusted: a crafted
/// database could otherwise carry triggers or views that call functions.
fn open_collection(path: &Path) -> Result<Connection> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags).map_err(not_a_collection)?;
    conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)
        .and_then(|_| {
            conn.set_db_config(
                rusqlite::config::DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA,
                false,
            )
        })
        .map_err(not_a_collection)?;
    // Opening is lazy; touch the schema so a non-database fails here.
    conn.query_row("SELECT count(*) FROM sqlite_schema", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(not_a_collection)?;
    Ok(conn)
}

fn not_a_collection(e: rusqlite::Error) -> ImportError {
    ImportError::Corrupt(format!("collection: {e}"))
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(media::hex(&hasher.finalize()))
}
