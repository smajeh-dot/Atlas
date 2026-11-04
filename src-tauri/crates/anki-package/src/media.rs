//! Extracts media files from the package into the work folder.
//!
//! Files are written under `media/<zip index>`, never under the name the
//! package claims, so no entry name can choose where a file lands.

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufWriter, Read, Seek, Write};
use std::path::Path;

use serde_json::Value;
use sha1::{Digest, Sha1};

use crate::error::{ImportError, Result};
use crate::limits::Budget;
use crate::names;
use crate::staging::{Media, Staging};

/// A legacy manifest is a few bytes per file; 64 MB means something is wrong.
const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;

/// Legacy packages: `media` is JSON `{"0": "name.png", …}` and files are raw.
pub(crate) fn extract_legacy<R: Read + Seek>(
    zip: &mut zip::ZipArchive<R>,
    work_dir: &Path,
    st: &Staging,
    budget: &mut Budget,
) -> Result<u64> {
    let Some(manifest) = read_manifest(zip)? else {
        return Ok(0);
    };
    let entries = match serde_json::from_slice::<Value>(&manifest) {
        Ok(Value::Object(map)) => map,
        _ => {
            return Err(ImportError::Corrupt(
                "media manifest is not a JSON object".into(),
            ))
        }
    };
    let mut list: Vec<(u64, String)> = Vec::with_capacity(entries.len());
    for (index, name) in entries {
        // Only plain decimal indices are accepted, so the staged path is always
        // `media/<digits>` whatever the manifest says.
        let parsed = index
            .parse::<u64>()
            .ok()
            .filter(|n| n.to_string() == index)
            .ok_or_else(|| {
                ImportError::Corrupt(format!("media index {index:?} is not a number"))
            })?;
        let name = name
            .as_str()
            .ok_or_else(|| ImportError::Corrupt("media name is not text".into()))?;
        list.push((parsed, name.to_owned()));
    }
    list.sort();

    stage_files(zip, &list, work_dir, st, budget)
}

/// Copies each listed file to `media/<index>` and records it under a name that
/// is safe on Windows and unique ignoring case, keeping the original name so
/// the importer can rewrite references to it.
fn stage_files<R: Read + Seek>(
    zip: &mut zip::ZipArchive<R>,
    list: &[(u64, String)],
    work_dir: &Path,
    st: &Staging,
    budget: &mut Budget,
) -> Result<u64> {
    let dir = work_dir.join("media");
    std::fs::create_dir_all(&dir)?;
    let mut taken = HashSet::new();
    let mut count = 0;
    for (index, original) in list {
        let entry_name = index.to_string();
        // A manifest entry with no file is missing media, which the importer
        // reports from the note text; it isn't a reason to stop.
        let Ok(entry) = zip.by_name(&entry_name) else {
            continue;
        };
        let staged = format!("media/{index}");
        let compressed = entry.compressed_size();
        let (size, sha1) = budget.copy(
            entry,
            compressed,
            &format!("media file {original:?}"),
            &dir.join(&entry_name),
        )?;

        let mut name = names::safe_media_name(original);
        if taken.contains(&names::collision_key(&name)) {
            name = names::with_hash_suffix(&name, &sha1);
        }
        if taken.contains(&names::collision_key(&name)) {
            // Same name and same content twice: the index keeps them apart.
            name = names::with_hash_suffix(&name, &entry_name);
        }
        taken.insert(names::collision_key(&name));

        let media = Media {
            name: &name,
            original_name: original,
            size,
            sha1: &sha1,
            staged_path: &staged,
        };
        if !st.media(&media)? {
            return Err(ImportError::Corrupt(format!(
                "media name {name:?} could not be made unique"
            )));
        }
        count += 1;
    }
    Ok(count)
}

fn read_manifest<R: Read + Seek>(zip: &mut zip::ZipArchive<R>) -> Result<Option<Vec<u8>>> {
    let entry = match zip.by_name("media") {
        Ok(e) => e,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(ImportError::Corrupt(format!("media manifest: {e}"))),
    };
    let mut buf = Vec::new();
    entry.take(MAX_MANIFEST_BYTES + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(ImportError::TooLarge("media manifest".into()));
    }
    Ok(Some(buf))
}

/// Streams `src` to `dest`, returning its size and hex SHA-1.
pub(crate) fn copy_hashing(src: &mut impl Read, dest: &Path) -> Result<(u64, String)> {
    let mut out = BufWriter::new(File::create(dest)?);
    let mut hasher = Sha1::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut size = 0u64;
    loop {
        let n = src.read(&mut buf).map_err(read_error)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n])?;
        size += n as u64;
    }
    out.flush()?;
    Ok((size, hex(&hasher.finalize())))
}

/// A read error from inside the zip means the archive is damaged, not the disk.
pub(crate) fn read_error(e: std::io::Error) -> ImportError {
    ImportError::Corrupt(format!("reading package: {e}"))
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
