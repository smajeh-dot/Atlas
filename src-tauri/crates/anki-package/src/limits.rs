//! Limits that stop a hostile or broken package from exhausting disk or memory.
//!
//! Sizes a zip *declares* are checked up front so obvious problems fail fast,
//! but they can lie, so every byte actually written is counted as well.

use std::io::Read;
use std::path::Path;

use crate::error::{ImportError, Result};
use crate::media::copy_hashing;

const MIB: u64 = 1024 * 1024;
const GIB: u64 = 1024 * MIB;

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Size of the .apkg file itself.
    pub max_package_bytes: u64,
    /// Number of entries in the zip.
    pub max_entries: usize,
    /// Decompressed size of any one entry (the collection, or one media file).
    pub max_entry_bytes: u64,
    /// Decompressed size of everything extracted, together.
    pub max_total_bytes: u64,
    /// How many times larger than its compressed size an entry may grow...
    pub max_ratio: u64,
    /// ...once it is bigger than this. Small files can compress very well harmlessly.
    pub ratio_floor_bytes: u64,
    /// Disk space to leave free after extracting, so the computer keeps working.
    pub reserve_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        // Generous for real collections (a large personal collection with
        // media is a few GB; deflate can't exceed ~1032:1 and real data is far
        // below 200:1), tight enough that a crafted file can't fill the disk.
        Self {
            max_package_bytes: 4 * GIB,
            max_entries: 250_000,
            max_entry_bytes: 2 * GIB,
            max_total_bytes: 16 * GIB,
            max_ratio: 200,
            ratio_floor_bytes: 16 * MIB,
            reserve_bytes: 256 * MIB,
        }
    }
}

#[derive(Clone, Copy)]
pub struct Options {
    pub limits: Limits,
    /// Bytes free on the disk holding a path. Swappable so tests can pretend the disk is full.
    pub free_space: fn(&Path) -> std::io::Result<u64>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            limits: Limits::default(),
            free_space: available_space,
        }
    }
}

/// Bytes available to this user on the disk that holds `path`.
pub fn available_space(path: &Path) -> std::io::Result<u64> {
    fs4::available_space(path)
}

/// Tracks bytes written across the whole import.
pub(crate) struct Budget {
    limits: Limits,
    used: u64,
}

impl Budget {
    pub fn new(limits: Limits) -> Self {
        Self { limits, used: 0 }
    }

    /// Copies one entry to `dest`, stopping as soon as any limit is passed.
    /// Returns its size and hex SHA-1.
    pub fn copy(
        &mut self,
        src: impl Read,
        compressed: u64,
        label: &str,
        dest: &Path,
    ) -> Result<(u64, String)> {
        let l = &self.limits;
        let ratio_cap = l
            .ratio_floor_bytes
            .max(compressed.saturating_mul(l.max_ratio));
        let total_left = l.max_total_bytes.saturating_sub(self.used);
        let (cap, reason) = [
            (l.max_entry_bytes, "is over the size limit for one file"),
            (total_left, "takes the package over its total size limit"),
            (
                ratio_cap,
                "expands too much for its compressed size (compression ratio)",
            ),
        ]
        .into_iter()
        .min_by_key(|(cap, _)| *cap)
        .unwrap_or((0, ""));

        // Read one byte past the cap so "exactly at the cap" and "over it" differ.
        let mut limited = src.take(cap.saturating_add(1));
        let (size, sha1) = copy_hashing(&mut limited, dest)?;
        if size > cap {
            let _ = std::fs::remove_file(dest);
            return Err(ImportError::TooLarge(format!("{label} {reason}")));
        }
        self.used += size;
        Ok((size, sha1))
    }
}

/// Checks what the zip declares before anything is extracted: the file, the
/// entry count, each entry, the total, and free disk space.
pub(crate) fn precheck<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    collection_entry: &str,
    package_bytes: u64,
    work_dir: &Path,
    options: &Options,
) -> Result<()> {
    let l = &options.limits;
    if package_bytes > l.max_package_bytes {
        return Err(ImportError::TooLarge(format!(
            "package is {package_bytes} bytes"
        )));
    }
    if zip.len() > l.max_entries {
        return Err(ImportError::TooLarge(format!(
            "package has {} entries",
            zip.len()
        )));
    }
    let (mut collection, mut media) = (0u64, 0u64);
    for i in 0..zip.len() {
        let entry = zip
            .by_index_raw(i)
            .map_err(|e| ImportError::Corrupt(format!("zip entry {i}: {e}")))?;
        let name = entry
            .name()
            .map_err(|e| ImportError::Corrupt(format!("zip entry {i}: {e}")))?;
        let is_media = !name.is_empty() && name.bytes().all(|b| b.is_ascii_digit());
        if name != collection_entry && !is_media {
            continue;
        }
        if entry.size() > l.max_entry_bytes {
            return Err(ImportError::TooLarge(format!(
                "{name} declares {} bytes",
                entry.size()
            )));
        }
        if is_media {
            media = media.saturating_add(entry.size());
        } else {
            collection = entry.size();
        }
    }
    let total = collection.saturating_add(media);
    if total > l.max_total_bytes {
        return Err(ImportError::TooLarge(format!(
            "package declares {total} bytes in total"
        )));
    }
    // The collection is copied out and then decoded into staging of a similar size.
    let needed = collection
        .saturating_mul(2)
        .saturating_add(media)
        .saturating_add(l.reserve_bytes);
    let available = (options.free_space)(work_dir)?;
    if available < needed {
        return Err(ImportError::NotEnoughDiskSpace { needed, available });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A source that never ends, like a decompressor fed a bomb.
    struct Endless(u64);
    impl Read for Endless {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            buf.fill(0);
            self.0 += buf.len() as u64;
            Ok(buf.len())
        }
    }

    fn small() -> Limits {
        Limits {
            max_entry_bytes: 10_000,
            max_total_bytes: 25_000,
            max_ratio: 10,
            ratio_floor_bytes: 1_000,
            ..Limits::default()
        }
    }

    #[test]
    fn an_endless_stream_stops_at_the_cap_and_leaves_no_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let dest = dir.path().join("out");
        let mut src = Endless(0);
        let err = Budget::new(small())
            .copy(&mut src, 5_000, "media file", &dest)
            .unwrap_err();
        assert!(
            matches!(err, ImportError::TooLarge(ref d) if d.contains("size limit for one file")),
            "{err:?}"
        );
        assert!(src.0 < 10_000 + 128 * 1024, "read {} bytes", src.0);
        assert!(!dest.exists());
    }

    #[test]
    fn the_ratio_cap_applies_above_the_floor() {
        let dir = tempfile::TempDir::new().unwrap();
        let mut budget = Budget::new(small());
        // 100 compressed bytes may become max(1_000, 100 × 10) = 1_000 bytes.
        let ok = budget
            .copy(&[1u8; 1_000][..], 100, "a", &dir.path().join("a"))
            .unwrap();
        assert_eq!(ok.0, 1_000);
        let err = budget
            .copy(&[1u8; 1_001][..], 100, "b", &dir.path().join("b"))
            .unwrap_err();
        assert!(
            matches!(err, ImportError::TooLarge(ref d) if d.contains("ratio")),
            "{err:?}"
        );
    }

    #[test]
    fn the_total_is_shared_across_entries() {
        let dir = tempfile::TempDir::new().unwrap();
        let mut budget = Budget::new(small());
        for name in ["a", "b"] {
            budget
                .copy(&[1u8; 10_000][..], 10_000, name, &dir.path().join(name))
                .unwrap();
        }
        let err = budget
            .copy(&[1u8; 10_000][..], 10_000, "c", &dir.path().join("c"))
            .unwrap_err();
        assert!(
            matches!(err, ImportError::TooLarge(ref d) if d.contains("total")),
            "{err:?}"
        );
    }
}
