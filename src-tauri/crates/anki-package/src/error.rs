use std::fmt;

/// Everything that can stop an import. The UI shows `message()`; `detail` is
/// for logs only, so raw library errors never reach the student.
#[derive(Debug)]
pub enum ImportError {
    /// Not a zip, or a zip with no Anki collection in it.
    NotAnApkg,
    /// The package or its collection is damaged or inconsistent.
    Corrupt(String),
    /// The package says it's a format version Atlas doesn't know.
    UnsupportedVersion(u32),
    /// Only Anki's "please update" placeholder is present.
    OnlyDummyCollection,
    /// A size or count limit was hit.
    TooLarge(String),
    NotEnoughDiskSpace {
        needed: u64,
        available: u64,
    },
    /// Reading the package or writing the work folder failed.
    Io(String),
}

impl ImportError {
    /// Stable identifier shared with the TypeScript `ImportErrorCode` union.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotAnApkg => "not_an_apkg",
            Self::Corrupt(_) => "corrupt",
            Self::UnsupportedVersion(_) => "unsupported_version",
            Self::OnlyDummyCollection => "only_dummy_collection",
            Self::TooLarge(_) => "too_large",
            Self::NotEnoughDiskSpace { .. } => "not_enough_disk_space",
            Self::Io(_) => "io",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::NotAnApkg => {
                "This isn't an Anki deck package. Choose a file ending in .apkg that was exported from Anki.".into()
            }
            Self::Corrupt(_) => {
                "This file looks damaged, so Atlas can't read it. Try exporting it from Anki again.".into()
            }
            Self::UnsupportedVersion(_) | Self::OnlyDummyCollection => {
                "This file was exported in a way Atlas can't read. In Anki, export again and tick 'Support older Anki versions'.".into()
            }
            Self::TooLarge(_) => "This file is too large for Atlas to import safely.".into(),
            Self::NotEnoughDiskSpace { .. } => {
                "There isn't enough free space on this computer to import this file. Free up some space and try again.".into()
            }
            Self::Io(_) => {
                "Atlas couldn't read or write a file while importing. Check the file is still there and try again.".into()
            }
        }
    }

    /// Technical detail for logs; never shown as the main message.
    pub fn detail(&self) -> String {
        match self {
            Self::NotAnApkg | Self::OnlyDummyCollection => String::new(),
            Self::Corrupt(d) | Self::TooLarge(d) | Self::Io(d) => d.clone(),
            Self::UnsupportedVersion(v) => format!("package version {v}"),
            Self::NotEnoughDiskSpace { needed, available } => {
                format!("needed {needed} bytes, {available} available")
            }
        }
    }
}

impl fmt::Display for ImportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = self.detail();
        if detail.is_empty() {
            write!(f, "{}", self.message())
        } else {
            write!(f, "{} ({detail})", self.message())
        }
    }
}

impl std::error::Error for ImportError {}

impl From<std::io::Error> for ImportError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

pub(crate) fn corrupt(context: &str) -> impl Fn(rusqlite::Error) -> ImportError + '_ {
    move |e| ImportError::Corrupt(format!("{context}: {e}"))
}

pub(crate) fn staging(e: rusqlite::Error) -> ImportError {
    ImportError::Io(format!("staging database: {e}"))
}

pub type Result<T> = std::result::Result<T, ImportError>;
