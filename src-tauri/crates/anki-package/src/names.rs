//! Media filenames from a package, made safe to use as Windows filenames.

use unicode_normalization::UnicodeNormalization;

/// Leaves room under Windows' 260-character path limit for %APPDATA%\Atlas\media\.
pub(crate) const MAX_NAME_BYTES: usize = 200;

/// Short enough to be a sensible extension; longer "extensions" are just part of the name.
const MAX_EXT_BYTES: usize = 16;

/// Turns any name from a package into one that is safe as a Windows filename.
///
/// Deterministic, so the same package always gives the same names, and
/// idempotent, so an already-safe name is returned unchanged. Rules:
/// NFC-normalise; replace path separators, `< > : " | ? *` and control
/// characters with `_`; replace a leading `.`; trim trailing dots and spaces;
/// prefix reserved device names (CON, COM1, …) with `_`; shorten anything over
/// MAX_NAME_BYTES, adding a hash of the original so different long names stay
/// different.
pub(crate) fn safe_media_name(raw: &str) -> String {
    let mut name: String = raw
        .nfc()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    if name.starts_with('.') {
        name.replace_range(..1, "_");
    }
    trim_trailing_dots_and_spaces(&mut name);
    if name.is_empty() {
        name = "unnamed".into();
    }
    if is_reserved(&name) {
        name.insert(0, '_');
    }
    if name.len() > MAX_NAME_BYTES {
        name = shorten(&name, &sha1_hex(raw.as_bytes()));
    }
    name
}

/// Two names that would be the same file on Windows have the same key.
pub(crate) fn collision_key(name: &str) -> String {
    name.nfc().flat_map(char::to_lowercase).collect()
}

/// `diagram.png` → `diagram-0123abcd.png`, still within MAX_NAME_BYTES.
pub(crate) fn with_hash_suffix(name: &str, hash_hex: &str) -> String {
    let (stem, ext) = split_ext(name);
    let suffix = format!("-{}", &hash_hex[..hash_hex.len().min(8)]);
    let room = MAX_NAME_BYTES.saturating_sub(suffix.len() + ext.len());
    let mut out = truncate_at_char(stem, room).to_owned();
    trim_trailing_dots_and_spaces(&mut out);
    out.push_str(&suffix);
    out.push_str(ext);
    out
}

fn shorten(name: &str, hash_hex: &str) -> String {
    with_hash_suffix(name, hash_hex)
}

/// Splits off a short, real-looking extension (including its dot).
fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 && name.len() - i <= MAX_EXT_BYTES && i + 1 < name.len() => {
            name.split_at(i)
        }
        _ => (name, ""),
    }
}

fn truncate_at_char(s: &str, max_bytes: usize) -> &str {
    let mut end = max_bytes.min(s.len());
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

fn trim_trailing_dots_and_spaces(s: &mut String) {
    let kept = s.trim_end_matches(['.', ' ']).len();
    s.truncate(kept);
}

/// Windows reserves these device names whatever the extension, and ignores
/// trailing spaces before the first dot when matching them.
fn is_reserved(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(' ')
        .to_uppercase();
    match stem.as_str() {
        "CON" | "PRN" | "AUX" | "NUL" => true,
        _ => ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|rest| {
                let mut chars = rest.chars();
                matches!((chars.next(), chars.next()), (Some(c), None) if c.is_ascii_digit() || "¹²³".contains(c))
            })
        }),
    }
}

fn sha1_hex(bytes: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    crate::media::hex(&Sha1::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Windows' rules written out independently of the code under test.
    fn is_valid(name: &str) -> bool {
        const RESERVED: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];
        let stem = name
            .split('.')
            .next()
            .unwrap_or("")
            .trim_end()
            .to_uppercase();
        let numbered = ["COM", "LPT"].iter().any(|p| {
            stem.strip_prefix(p).is_some_and(|rest| {
                rest.chars().count() == 1
                    && rest
                        .chars()
                        .all(|c| c.is_ascii_digit() || "¹²³".contains(c))
            })
        });
        !name.is_empty()
            && name.len() <= MAX_NAME_BYTES
            && !name.starts_with('.')
            && !name.ends_with('.')
            && !name.ends_with(' ')
            && !name
                .chars()
                .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
            && !RESERVED.contains(&stem.as_str())
            && !numbered
            && name.nfc().eq(name.chars())
    }

    #[test]
    fn ordinary_names_are_left_alone() {
        for n in [
            "benzene.png",
            "café.png",
            "_bg-tile.png",
            "diagram 1.svg",
            "a.b.c.mp3",
            "日本語.png",
            "CONSOLE.png",
            "COM10.png",
        ] {
            assert_eq!(safe_media_name(n), n);
        }
    }

    #[test]
    fn separators_and_traversal_are_removed() {
        assert_eq!(safe_media_name("a/b.png"), "a_b.png");
        assert_eq!(safe_media_name("a\\b.png"), "a_b.png");
        for n in [
            "../evil.png",
            "..\\evil.png",
            "../../../../Windows/evil.png",
            "/etc/passwd",
            "C:\\Windows\\x.png",
            "\\\\server\\share\\x.png",
        ] {
            let safe = safe_media_name(n);
            assert!(is_valid(&safe), "{n:?} became {safe:?}");
        }
    }

    #[test]
    fn characters_windows_forbids_become_underscores() {
        for c in [
            '<', '>', ':', '"', '|', '?', '*', '\0', '\n', '\t', '\u{7f}', '\u{9b}',
        ] {
            assert_eq!(safe_media_name(&format!("a{c}b.png")), "a_b.png", "{c:?}");
        }
    }

    #[test]
    fn trailing_dots_and_spaces_are_trimmed() {
        assert_eq!(safe_media_name("a.png."), "a.png");
        assert_eq!(safe_media_name("a.png   "), "a.png");
        assert_eq!(safe_media_name("a. . ."), "a");
    }

    #[test]
    fn leading_dots_and_empty_names() {
        assert_eq!(safe_media_name(".hidden.png"), "_hidden.png");
        for n in ["", ".", "..", "...", " ", ". ."] {
            let safe = safe_media_name(n);
            assert!(is_valid(&safe), "{n:?} became {safe:?}");
        }
    }

    #[test]
    fn reserved_device_names_are_prefixed() {
        assert_eq!(safe_media_name("CON.png"), "_CON.png");
        assert_eq!(safe_media_name("con"), "_con");
        assert_eq!(safe_media_name("nul.tar.gz"), "_nul.tar.gz");
        for n in [
            "PRN.mp3",
            "aux.png",
            "COM1.png",
            "com9",
            "LPT1.txt",
            "lpt0.png",
            "COM¹.png",
            "CON .png",
        ] {
            let safe = safe_media_name(n);
            assert!(is_valid(&safe), "{n:?} became {safe:?}");
        }
    }

    #[test]
    fn long_names_are_shortened_keeping_extension_and_distinctness() {
        let a = format!("{}.png", "a".repeat(300));
        let b = format!("{}b.png", "a".repeat(299));
        let (sa, sb) = (safe_media_name(&a), safe_media_name(&b));
        assert!(sa.len() <= MAX_NAME_BYTES && sb.len() <= MAX_NAME_BYTES);
        assert!(sa.ends_with(".png") && sb.ends_with(".png"));
        assert_ne!(sa, sb);
        // Multi-byte characters are never split.
        let c = safe_media_name(&"é".repeat(150));
        assert!(c.len() <= MAX_NAME_BYTES && is_valid(&c));
    }

    #[test]
    fn names_are_nfc_normalised() {
        assert_eq!(safe_media_name("cafe\u{301}.png"), "café.png");
    }

    #[test]
    fn every_result_is_valid_and_sanitising_twice_changes_nothing() {
        // A small deterministic generator rather than a property-testing crate.
        let alphabet: Vec<char> = "aZ09 ._-/\\:<>\"|?*\0\u{1f}é\u{301}¹CONPRLUXMT"
            .chars()
            .collect();
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        for _ in 0..20_000 {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let len = (seed % 12) as usize;
            let raw: String = (0..len)
                .map(|i| alphabet[((seed >> (i * 5)) as usize) % alphabet.len()])
                .collect();
            let safe = safe_media_name(&raw);
            assert!(is_valid(&safe), "{raw:?} became {safe:?}");
            assert_eq!(safe_media_name(&safe), safe, "{raw:?}");
        }
    }

    #[test]
    fn collision_key_ignores_case_and_normalisation() {
        assert_eq!(collision_key("A.PNG"), collision_key("a.png"));
        assert_eq!(collision_key("É.png"), collision_key("é.png"));
        assert_eq!(collision_key("Café.png"), collision_key("cafe\u{301}.PNG"));
        assert_ne!(collision_key("a.png"), collision_key("b.png"));
    }

    #[test]
    fn hash_suffix_goes_before_the_extension() {
        assert_eq!(
            with_hash_suffix("diagram.png", "0123456789abcdef"),
            "diagram-01234567.png"
        );
        assert_eq!(
            with_hash_suffix("notes", "0123456789abcdef"),
            "notes-01234567"
        );
        let long = safe_media_name(&format!("{}.png", "x".repeat(300)));
        let suffixed = with_hash_suffix(&long, "0123456789abcdef");
        assert!(
            suffixed.len() <= MAX_NAME_BYTES
                && suffixed.ends_with("-01234567.png")
                && is_valid(&suffixed)
        );
    }
}
