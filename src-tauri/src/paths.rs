use std::io;
use std::path::PathBuf;

/// `%APPDATA%\Atlas` on Windows. Kept outside the exe's folder so replacing
/// or moving `Atlas.exe` never touches anyone's cards.
pub fn data_dir() -> PathBuf {
    dirs::data_dir()
        .expect("the system has no user data folder")
        .join("Atlas")
}

pub fn ensure_dirs() -> io::Result<PathBuf> {
    let dir = data_dir();
    std::fs::create_dir_all(dir.join("media"))?;
    std::fs::create_dir_all(dir.join("backups"))?;
    std::fs::create_dir_all(dir.join("tmp"))?;
    Ok(dir)
}
