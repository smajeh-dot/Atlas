use std::path::PathBuf;

/// `%APPDATA%\Atlas` on Windows. Kept outside the exe's folder so replacing
/// or moving `Atlas.exe` never touches anyone's cards. None if Windows reports
/// no user data folder, which start-up turns into a message instead of a crash.
pub fn data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("Atlas"))
}

pub fn media_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join("media"))
}

pub fn ensure_dirs() -> Result<PathBuf, String> {
    let dir = data_dir().ok_or("Windows did not report a user data folder (%APPDATA%).")?;
    for sub in ["media", "backups"] {
        std::fs::create_dir_all(dir.join(sub))
            .map_err(|e| format!("Atlas couldn't create {}: {e}", dir.join(sub).display()))?;
    }
    Ok(dir)
}
