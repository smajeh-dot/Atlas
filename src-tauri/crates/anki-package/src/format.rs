//! Works out which of Anki's package layouts a file uses.
//!
//! Follows Anki's own rule: the `meta` entry decides the version when it
//! exists; otherwise `collection.anki21` means legacy v2 and
//! `collection.anki2` means legacy v1. See tests/fixtures/anki/README.md.

use std::io::{Read, Seek};

use crate::error::{ImportError, Result};
use crate::proto::{Fields, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceFormat {
    /// Before Anki 2.1.50: no `meta`, the collection is `collection.anki2`.
    Legacy1,
    /// "Support older Anki versions": `collection.anki21` plus a placeholder.
    Legacy2,
    /// Anki 2.1.50 and later: zstd-compressed `collection.anki21b`.
    Modern,
}

impl SourceFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Legacy1 => "legacy1",
            Self::Legacy2 => "legacy2",
            Self::Modern => "modern",
        }
    }

    pub(crate) fn collection_entry(self) -> &'static str {
        match self {
            Self::Legacy1 => "collection.anki2",
            Self::Legacy2 => "collection.anki21",
            Self::Modern => "collection.anki21b",
        }
    }
}

#[derive(Debug)]
pub(crate) struct Layout {
    pub format: SourceFormat,
    /// `PackageMetadata.version`, if the package has a `meta` entry.
    pub package_version: Option<u32>,
}

/// Anki's `meta` entry is tiny; anything bigger isn't a real one.
const MAX_META_BYTES: u64 = 1024;

pub(crate) fn detect<R: Read + Seek>(zip: &mut zip::ZipArchive<R>) -> Result<Layout> {
    let has = |zip: &zip::ZipArchive<R>, name: &str| zip.index_for_name(name).is_some();

    let package_version = if has(zip, "meta") {
        let mut buf = Vec::new();
        let entry = zip
            .by_name("meta")
            .map_err(|e| ImportError::Corrupt(format!("meta: {e}")))?;
        entry.take(MAX_META_BYTES + 1).read_to_end(&mut buf)?;
        if buf.len() as u64 > MAX_META_BYTES {
            return Err(ImportError::Corrupt("meta entry is too large".into()));
        }
        Some(package_version(&buf)?)
    } else {
        None
    };

    let format = match package_version {
        Some(1) => SourceFormat::Legacy1,
        Some(2) => SourceFormat::Legacy2,
        Some(3) => SourceFormat::Modern,
        Some(v) => return Err(ImportError::UnsupportedVersion(v)),
        None if has(zip, "collection.anki21") => SourceFormat::Legacy2,
        None if has(zip, "collection.anki2") => SourceFormat::Legacy1,
        None if has(zip, "collection.anki21b") => {
            // Modern collection without the meta that should describe it.
            return Err(ImportError::Corrupt(
                "collection.anki21b without meta".into(),
            ));
        }
        None => return Err(ImportError::NotAnApkg),
    };

    if !has(zip, format.collection_entry()) {
        return Err(ImportError::Corrupt(format!(
            "package version says {} but it is missing",
            format.collection_entry()
        )));
    }
    Ok(Layout {
        format,
        package_version,
    })
}

/// Decodes `PackageMetadata { Version version = 1; }`. An absent field is
/// protobuf's default, 0 (VERSION_UNKNOWN).
fn package_version(buf: &[u8]) -> Result<u32> {
    let mut version = 0u64;
    for field in Fields::new(buf) {
        if let (1, Value::Varint(v)) = field? {
            version = v;
        }
    }
    u32::try_from(version).map_err(|_| ImportError::UnsupportedVersion(u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_the_versions_anki_writes() {
        assert_eq!(package_version(&[0x08, 0x02]).unwrap(), 2);
        assert_eq!(package_version(&[0x08, 0x03]).unwrap(), 3);
        assert_eq!(package_version(&[]).unwrap(), 0);
    }
}
