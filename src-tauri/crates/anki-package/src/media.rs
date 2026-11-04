//! Extracts media files from the package into the work folder.
//!
//! Files are written under `media/<zip entry number>`, never under the name the
//! package claims, so no entry name can choose where a file lands.

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufWriter, Read, Seek, Write};
use std::path::Path;

use serde_json::Value;
use sha1::{Digest, Sha1};

use ruzstd::decoding::errors::FrameDecoderError;
use ruzstd::decoding::{FrameDecoder, StreamingDecoder};

use crate::error::{ImportError, Result};
use crate::format::SourceFormat;
use crate::limits::Budget;
use crate::names;
use crate::proto::Message;
use crate::staging::{Media, Staging};

/// A manifest is a few bytes per file; 64 MB means something is wrong.
const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;

/// Larger zstd windows are refused before anything is allocated. Anki's own
/// files use far smaller ones; a crafted frame could otherwise ask for
/// gigabytes of memory.
pub(crate) const MAX_ZSTD_WINDOW: u64 = 128 * 1024 * 1024;

/// One file the manifest lists.
pub(crate) struct Item {
    /// The zip entry holding the file: always plain digits.
    pub zip_entry: String,
    /// The name the package gives it.
    pub name: String,
    /// Expected size, for the disk-space estimate only; actual bytes are counted.
    pub size_hint: u64,
}

/// Reads the media manifest. Legacy packages use JSON `{"0": "name.png", …}`;
/// modern ones a zstd-compressed protobuf `MediaEntries`.
pub(crate) fn read_list<R: Read + Seek>(
    zip: &mut zip::ZipArchive<R>,
    format: SourceFormat,
) -> Result<Vec<Item>> {
    let Some(raw) = read_manifest(zip)? else {
        return Ok(Vec::new());
    };
    let mut items = match format {
        SourceFormat::Modern => modern_list(&raw)?,
        SourceFormat::Legacy1 | SourceFormat::Legacy2 => legacy_list(&raw)?,
    };
    if format != SourceFormat::Modern {
        for item in &mut items {
            item.size_hint = zip.by_name(&item.zip_entry).map(|e| e.size()).unwrap_or(0);
        }
    }
    Ok(items)
}

fn legacy_list(raw: &[u8]) -> Result<Vec<Item>> {
    let entries = match serde_json::from_slice::<Value>(raw) {
        Ok(Value::Object(map)) => map,
        _ => {
            return Err(ImportError::Corrupt(
                "media manifest is not a JSON object".into(),
            ))
        }
    };
    let mut list = Vec::with_capacity(entries.len());
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
    Ok(list
        .into_iter()
        .map(|(i, name)| Item {
            zip_entry: i.to_string(),
            name,
            size_hint: 0,
        })
        .collect())
}

/// `MediaEntries { repeated MediaEntry entries = 1; }` where `MediaEntry` has
/// name = 1, size = 2, sha1 = 3 and optional legacy_zip_filename = 255. The
/// file for list item i is zip entry `i` unless legacy_zip_filename says otherwise.
fn modern_list(raw: &[u8]) -> Result<Vec<Item>> {
    let mut decoded = Vec::new();
    zstd(raw, "media manifest")?
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut decoded)
        .map_err(read_error)?;
    if decoded.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(ImportError::TooLarge("media manifest".into()));
    }
    let manifest = Message::parse(&decoded)?;
    let mut list = Vec::new();
    for (i, entry) in manifest.messages(1)?.iter().enumerate() {
        let zip_entry = if entry.has(255) {
            entry.uint(255)?
        } else {
            i as u64
        };
        list.push(Item {
            zip_entry: zip_entry.to_string(),
            name: entry.string(1)?,
            size_hint: entry.uint(2)?,
        });
    }
    Ok(list)
}

/// A zstd decoder that refuses oversized windows up front.
pub(crate) fn zstd<R: Read>(src: R, what: &str) -> Result<StreamingDecoder<R, FrameDecoder>> {
    StreamingDecoder::new_with_max_window_size(src, MAX_ZSTD_WINDOW).map_err(|e| match e {
        FrameDecoderError::WindowSizeTooBig { requested, .. } => {
            ImportError::TooLarge(format!("{what} asks for a {requested}-byte zstd window"))
        }
        other => ImportError::Corrupt(format!("{what}: zstd: {other}")),
    })
}

/// Copies each listed file to `media/<zip entry>` and records it under a name
/// that is safe on Windows and unique ignoring case, keeping the original name
/// so the importer can rewrite references to it.
pub(crate) fn stage<R: Read + Seek>(
    zip: &mut zip::ZipArchive<R>,
    items: &[Item],
    compressed: bool,
    work_dir: &Path,
    st: &Staging,
    budget: &mut Budget,
) -> Result<u64> {
    let dir = work_dir.join("media");
    std::fs::create_dir_all(&dir)?;
    let mut taken = HashSet::new();
    let mut count = 0;
    for item in items {
        // A manifest entry with no file is missing media, which the importer
        // reports from the note text; it isn't a reason to stop.
        let Ok(entry) = zip.by_name(&item.zip_entry) else {
            continue;
        };
        let staged = format!("media/{}", item.zip_entry);
        let label = format!("media file {:?}", item.name);
        let packed = entry.compressed_size();
        let dest = dir.join(&item.zip_entry);
        let (size, sha1) = if compressed {
            budget.copy(zstd(entry, &label)?, packed, &label, &dest)?
        } else {
            budget.copy(entry, packed, &label, &dest)?
        };

        let mut name = names::safe_media_name(&item.name);
        if taken.contains(&names::collision_key(&name)) {
            name = names::with_hash_suffix(&name, &sha1);
        }
        if taken.contains(&names::collision_key(&name)) {
            // Same name and same content twice: the entry number keeps them apart.
            name = names::with_hash_suffix(&name, &item.zip_entry);
        }
        taken.insert(names::collision_key(&name));

        let media = Media {
            name: &name,
            original_name: &item.name,
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
    entry
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(read_error)?;
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
