//! Reads an extracted Anki collection into staging. Notes, cards and the
//! review log have the same columns in every schema; note types, decks and
//! deck options differ, so `legacy` (schema 11) and `modern` (schema 18)
//! read those.

use rusqlite::types::ValueRef;
use rusqlite::{Connection, Row};

use crate::error::{corrupt, ImportError, Result};
use crate::staging::{Card, Note, Staging};
use crate::{legacy, modern};

/// The first field of the single note in Anki's placeholder collection.
const DUMMY_NOTE_PREFIX: &str = "Please update to the latest Anki version";

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Counts {
    pub decks: u64,
    pub deck_configs: u64,
    pub notetypes: u64,
    pub notes: u64,
    pub cards: u64,
    pub revlog: u64,
    pub media: u64,
}

pub(crate) fn read(src: &Connection, st: &Staging) -> Result<Counts> {
    refuse_placeholder(src)?;
    let mut counts = Counts::default();

    let (crt, ver): (i64, i64) = src
        .query_row("SELECT crt, ver FROM col", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(corrupt("col row"))?;
    st.meta("anki_schema", &ver.to_string())?;
    st.meta("anki_crt", &crt.to_string())?;
    // The schema version, not the zip layout, decides where metadata lives.
    match ver {
        11 => legacy::read_metadata(src, st, &mut counts)?,
        18 => modern::read_metadata(src, st, &mut counts)?,
        _ => {
            return Err(ImportError::UnsupportedVersion(
                ver.clamp(0, u32::MAX as i64) as u32,
            ))
        }
    }

    counts.notes = copy_rows(
        src,
        "SELECT id, guid, mid, mod, tags, flds FROM notes",
        "notes",
        |r| {
            st.note(&Note {
                id: int(r, 0, "notes.id")?,
                guid: text(r, 1, "notes.guid")?,
                notetype_id: int(r, 2, "notes.mid")?,
                mod_secs: int(r, 3, "notes.mod")?,
                tags: text(r, 4, "notes.tags")?,
                fields: text(r, 5, "notes.flds")?,
            })
        },
    )?;

    const CARD_COLS: [&str; 15] = [
        "id", "nid", "did", "odid", "ord", "type", "queue", "due", "ivl", "factor", "reps",
        "lapses", "left", "odue", "flags",
    ];
    let sql = format!("SELECT {}, data FROM cards", CARD_COLS.join(", "));
    counts.cards = copy_rows(src, &sql, "cards", |r| {
        let mut cols = [0i64; 15];
        for (i, col) in cols.iter_mut().enumerate() {
            *col = int(r, i, CARD_COLS[i])?;
        }
        st.card(&Card {
            cols,
            data: text(r, 15, "cards.data")?,
        })
    })?;

    counts.revlog = copy_rows(
        src,
        "SELECT id, cid, ease, ivl, lastIvl, factor, time, type FROM revlog",
        "revlog",
        |r| {
            let mut cols = [0i64; 8];
            for (i, col) in cols.iter_mut().enumerate() {
                *col = int(r, i, "revlog")?;
            }
            st.revlog(&cols)
        },
    )?;

    Ok(counts)
}

/// Anki 2.1.50+ puts a one-note "please update" collection in
/// `collection.anki2`. If that's all there is, importing it would give the
/// student a deck containing just that message.
fn refuse_placeholder(src: &Connection) -> Result<()> {
    let mut firsts = Vec::new();
    copy_rows(src, "SELECT flds FROM notes LIMIT 2", "notes", |r| {
        firsts.push(text(r, 0, "notes.flds")?);
        Ok(())
    })?;
    if let [only] = firsts.as_slice() {
        if only.starts_with(DUMMY_NOTE_PREFIX) {
            return Err(ImportError::OnlyDummyCollection);
        }
    }
    Ok(())
}

pub(crate) fn copy_rows(
    src: &Connection,
    sql: &str,
    what: &str,
    mut each: impl FnMut(&Row) -> Result<()>,
) -> Result<u64> {
    let mut stmt = src.prepare(sql).map_err(corrupt(what))?;
    let mut rows = stmt.query([]).map_err(corrupt(what))?;
    let mut n = 0;
    while let Some(row) = rows.next().map_err(corrupt(what))? {
        each(row)?;
        n += 1;
    }
    Ok(n)
}

/// SQLite doesn't enforce column types, and add-ons have been known to write
/// floats into integer columns. Accept anything that is plainly a number.
pub(crate) fn int(r: &Row, i: usize, what: &str) -> Result<i64> {
    match r.get_ref(i).map_err(corrupt(what))? {
        ValueRef::Integer(v) => Ok(v),
        ValueRef::Real(f) if f.is_finite() => Ok(f as i64),
        ValueRef::Text(t) => std::str::from_utf8(t)
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .ok_or_else(|| bad(&format!("{what} is not a number"))),
        _ => Err(bad(&format!("{what} is not a number"))),
    }
}

/// Text that isn't valid UTF-8 is repaired rather than rejected: losing one
/// odd character beats refusing a whole deck.
pub(crate) fn text(r: &Row, i: usize, what: &str) -> Result<String> {
    Ok(match r.get_ref(i).map_err(corrupt(what))? {
        ValueRef::Text(t) | ValueRef::Blob(t) => String::from_utf8_lossy(t).into_owned(),
        ValueRef::Integer(v) => v.to_string(),
        ValueRef::Real(f) => f.to_string(),
        ValueRef::Null => String::new(),
    })
}

/// A blob column, or an empty one for NULL (protobuf's "all defaults").
pub(crate) fn blob(r: &Row, i: usize, what: &str) -> Result<Vec<u8>> {
    match r.get_ref(i).map_err(corrupt(what))? {
        ValueRef::Blob(b) | ValueRef::Text(b) => Ok(b.to_vec()),
        ValueRef::Null => Ok(Vec::new()),
        _ => Err(bad(&format!("{what} is not a blob"))),
    }
}

pub(crate) fn bad(detail: &str) -> ImportError {
    ImportError::Corrupt(detail.to_owned())
}
