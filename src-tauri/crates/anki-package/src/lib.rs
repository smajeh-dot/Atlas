//! Reads Anki `.apkg` files into Atlas's staging database.
//!
//! This crate owns everything that touches the untrusted package bytes. It
//! decodes the package into a plain SQLite file (`staging.sql`) plus extracted
//! media, and makes no decisions about how to import; the TypeScript importer
//! reads the staging file and does the mapping. It deliberately has no Tauri
//! dependency so it builds and tests on any machine.
//!
//! Decisions worth knowing:
//! - zstd uses `ruzstd` (pure Rust, no C toolchain needed on Windows). It
//!   decoded about 200 MB/s in a release build here, so a large collection
//!   takes about a second. Swap for the `zstd` crate only if that changes.
//! - Protobuf is decoded by hand (`proto.rs`) for the dozen fields needed,
//!   rather than with a code generator and Anki's AGPL-licensed .proto files.

mod collection;
mod error;
mod format;
mod install;
mod legacy;
mod limits;
mod media;
mod modern;
mod names;
mod proto;
mod staging;
mod workdir;

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};

pub use collection::Counts;
pub use error::{ImportError, Result};
pub use format::SourceFormat;
pub use install::{install_media, remove_media, remove_stale_media_temps, InstallFile};
pub use limits::{available_space, Limits, Options};
pub use staging::{STAGING_SCHEMA, STAGING_VERSION};
pub use workdir::{remove_stale, WorkDir};

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
    prepare_with(apkg, work_dir, &Options::default())
}

/// `prepare` with explicit limits, for tests and callers that need them.
pub fn prepare_with(apkg: &Path, work_dir: &Path, options: &Options) -> Result<Prepared> {
    // Check the size before hashing, so an enormous file is refused at once.
    let package_bytes = std::fs::metadata(apkg)?.len();
    if package_bytes > options.limits.max_package_bytes {
        return Err(ImportError::TooLarge(format!(
            "package is {package_bytes} bytes"
        )));
    }
    let source_sha256 = sha256_file(apkg)?;
    let mut zip = open_zip(apkg)?;
    if zip.len() > options.limits.max_entries {
        return Err(ImportError::TooLarge(format!(
            "package has {} entries",
            zip.len()
        )));
    }
    let layout = format::detect(&mut zip)?;
    let entry_name = layout.format.collection_entry();
    let compressed = layout.format == SourceFormat::Modern;
    let declared = limits::check_declared(&mut zip, entry_name, package_bytes, &options.limits)?;
    let items = media::read_list(&mut zip, layout.format)?;
    // Modern media sizes in the zip are compressed; the manifest knows the real ones.
    let media_estimate = if compressed {
        items.iter().map(|i| i.size_hint).sum()
    } else {
        declared.media
    };
    let mut budget = limits::Budget::new(options.limits);

    let collection_path = work_dir.join("collection.sqlite");
    {
        let entry = zip
            .by_name(entry_name)
            .map_err(|e| ImportError::Corrupt(format!("collection: {e}")))?;
        let packed = entry.compressed_size();
        if compressed {
            let decoder = media::zstd(entry, entry_name)?;
            // The frame header usually states the decoded size; if not, guess
            // generously. Either way the budget counts the real bytes.
            let stated = decoder.decoder.content_size();
            let estimate = if stated > 0 {
                stated
            } else {
                packed.saturating_mul(8)
            };
            limits::check_disk(
                work_dir,
                estimate.min(options.limits.max_entry_bytes),
                media_estimate,
                options,
            )?;
            budget.copy(decoder, packed, entry_name, &collection_path)?;
        } else {
            limits::check_disk(work_dir, declared.collection, media_estimate, options)?;
            budget.copy(entry, packed, entry_name, &collection_path)?;
        }
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
    st.meta("collection_entry", entry_name)?;
    st.meta("source_sha256", &source_sha256)?;

    let mut counts = {
        let src = open_collection(&collection_path)?;
        collection::read(&src, &st)?
    };
    counts.media = media::stage(&mut zip, &items, compressed, work_dir, &st, &mut budget)?;
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
    // Schema-18 name columns use Anki's own `unicase` collation. The queries
    // below don't need it today, but if SQLite ever picks one of those indexes
    // (as any query on `tags` does), it would fail without it.
    conn.create_collation("unicase", unicase_cmp)
        .map_err(not_a_collection)?;
    // Opening is lazy; touch the schema so a non-database fails here.
    conn.query_row("SELECT count(*) FROM sqlite_schema", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(not_a_collection)?;
    Ok(conn)
}

/// Case-insensitive Unicode comparison, as Anki's `unicase` collation does.
fn unicase_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.chars()
        .flat_map(char::to_lowercase)
        .cmp(b.chars().flat_map(char::to_lowercase))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The real modern collection from the fixtures, decompressed to a file.
    fn modern_collection(dir: &Path) -> PathBuf {
        let apkg = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/anki/rich-modern.apkg");
        let mut zip = zip::ZipArchive::new(File::open(apkg).unwrap()).unwrap();
        let entry = zip.by_name("collection.anki21b").unwrap();
        let path = dir.join("c.db");
        media::copy_hashing(&mut media::zstd(entry, "test").unwrap(), &path).unwrap();
        path
    }

    #[test]
    fn the_unicase_collation_lets_anki_tables_be_read() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = modern_collection(dir.path());
        // Comparing a name column uses its collation.
        let sql = "SELECT count(*) FROM decks WHERE name = 'CHEM'";
        let plain = Connection::open(&path).unwrap();
        assert!(
            plain.query_row(sql, [], |r| r.get::<_, i64>(0)).is_err(),
            "expected SQLite to need unicase"
        );
        let ours = open_collection(&path).unwrap();
        assert_eq!(
            ours.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap(),
            1,
            "'CHEM' should match 'Chem'"
        );
    }

    #[test]
    fn unicase_ignores_case_across_scripts() {
        use std::cmp::Ordering::*;
        assert_eq!(unicase_cmp("Chem", "chem"), Equal);
        assert_eq!(unicase_cmp("SÄURE", "säure"), Equal);
        assert_eq!(unicase_cmp("a", "B"), Less);
    }
}
