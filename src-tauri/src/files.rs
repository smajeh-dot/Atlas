use std::borrow::Cow;
use std::io::Write;

use tauri::http::{Request, Response, StatusCode};
use tauri::ipc::InvokeBody;

use crate::paths;

/// A plain file name inside the media folder: no folders, no drive letters, nothing hidden.
/// Card HTML refers to media by bare name, so anything else is refused.
fn is_bare_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '\0'])
}

/// Names Atlas itself writes (pasted images) are stricter still.
fn is_writable_name(name: &str) -> bool {
    is_bare_name(name)
        && name.len() <= 200
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn content_type(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// Saves a pasted image. The body is the file's bytes and the `x-media-name` header its name,
/// so large images are not sent as JSON. An existing file with that name is identical
/// (names come from a hash of the content), so it is left alone.
#[tauri::command]
pub fn media_write(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let name = request
        .headers()
        .get("x-media-name")
        .and_then(|v| v.to_str().ok())
        .ok_or("The image has no name.")?
        .to_string();
    if !is_writable_name(&name) {
        return Err(format!("\"{name}\" is not a valid media file name."));
    }
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("The image data was not sent as raw bytes.".into());
    };
    let dir = paths::media_dir().ok_or("Atlas has no media folder.")?;
    let path = dir.join(&name);
    if path.exists() {
        return Ok(());
    }
    let mut file = std::fs::File::create(&path).map_err(|e| format!("Atlas couldn't save the image: {e}"))?;
    file.write_all(bytes).map_err(|e| format!("Atlas couldn't save the image: {e}"))
}

/// Serves `media\<name>` to card HTML through the `media` URI scheme
/// (`http://media.localhost/<name>` on Windows).
pub fn serve_media(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Cow::Borrowed(&[][..]))
            .expect("static response")
    };
    let Some(name) = percent_decode(request.uri().path().trim_start_matches('/')) else {
        return not_found();
    };
    if !is_bare_name(&name) {
        return not_found();
    }
    let Some(dir) = paths::media_dir() else {
        return not_found();
    };
    match std::fs::read(dir.join(&name)) {
        Ok(bytes) => Response::builder()
            .header("Content-Type", content_type(&name))
            .body(Cow::Owned(bytes))
            .unwrap_or_else(|_| not_found()),
        Err(_) => not_found(),
    }
}
