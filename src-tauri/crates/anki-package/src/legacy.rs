//! Reads schema-11 collections (`collection.anki2` and `collection.anki21`).
//! Note types, decks and deck configs are JSON strings in the single `col` row.

use rusqlite::types::ValueRef;
use rusqlite::{Connection, Row};
use serde_json::{Map, Value};

use crate::error::{corrupt, ImportError, Result};
use crate::staging::{Card, DeckConfig, Note, Notetype, Staging};

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

    let (crt, ver, conf, models, decks, dconf): (i64, i64, String, String, String, String) = src
        .query_row(
            "SELECT crt, ver, conf, models, decks, dconf FROM col",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .map_err(corrupt("col row"))?;
    if ver != 11 {
        return Err(ImportError::Corrupt(format!(
            "legacy collection has schema {ver}"
        )));
    }
    let conf = parse_object(&conf, "col.conf")?;
    st.meta("anki_schema", &ver.to_string())?;
    st.meta("anki_crt", &crt.to_string())?;
    // Anki leaves `rollover` out of conf while it's still the default.
    st.meta(
        "anki_rollover_hour",
        &int_or(&conf, "rollover", 4).to_string(),
    )?;
    st.meta(
        "anki_creation_offset",
        &opt_int(&conf, "creationOffset")
            .map(|v| v.to_string())
            .unwrap_or_default(),
    )?;
    st.meta(
        "anki_sched_ver",
        &opt_int(&conf, "schedVer")
            .map(|v| v.to_string())
            .unwrap_or_default(),
    )?;

    for (key, m) in parse_object(&models, "col.models")? {
        st.notetype(&notetype(&key, &m)?)?;
        counts.notetypes += 1;
    }
    for (key, d) in parse_object(&decks, "col.decks")? {
        let d = as_object(&d, "deck")?;
        let id = id_of(&key, d)?;
        let name = str_of(d, "name").ok_or_else(|| bad("deck without a name"))?;
        // Old files store `dyn` as 0/1, newer ones as a boolean.
        let filtered = match d.get("dyn") {
            Some(Value::Bool(b)) => *b,
            Some(v) => v.as_i64().unwrap_or(0) != 0,
            None => false,
        };
        let config_id = if filtered { None } else { opt_int(d, "conf") };
        st.deck(id, name, filtered, config_id)?;
        counts.decks += 1;
    }
    for (key, c) in parse_object(&dconf, "col.dconf")? {
        let c = as_object(&c, "deck config")?;
        let section = |name: &str| c.get(name).and_then(Value::as_object);
        let empty = Map::new();
        let new = section("new").unwrap_or(&empty);
        let rev = section("rev").unwrap_or(&empty);
        let lapse = section("lapse").unwrap_or(&empty);
        st.deck_config(&DeckConfig {
            id: id_of(&key, c)?,
            name: str_of(c, "name").unwrap_or_default().to_owned(),
            new_per_day: int_or(new, "perDay", 20),
            reviews_per_day: int_or(rev, "perDay", 200),
            learn_steps_min: steps(new),
            relearn_steps_min: steps(lapse),
            desired_retention: c.get("desiredRetention").and_then(Value::as_f64),
        })?;
        counts.deck_configs += 1;
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
    let mut stmt = src
        .prepare("SELECT flds FROM notes LIMIT 2")
        .map_err(corrupt("notes"))?;
    let mut firsts = Vec::new();
    let mut rows = stmt.query([]).map_err(corrupt("notes"))?;
    while let Some(row) = rows.next().map_err(corrupt("notes"))? {
        firsts.push(text(row, 0, "notes.flds")?);
    }
    if let [only] = firsts.as_slice() {
        if only.starts_with(DUMMY_NOTE_PREFIX) {
            return Err(ImportError::OnlyDummyCollection);
        }
    }
    Ok(())
}

fn notetype(key: &str, m: &Value) -> Result<Notetype> {
    let m = as_object(m, "note type")?;
    let list = |name: &str| -> Result<Vec<Map<String, Value>>> {
        let mut items: Vec<(i64, Map<String, Value>)> = m
            .get(name)
            .and_then(Value::as_array)
            .ok_or_else(|| bad(&format!("note type without {name}")))?
            .iter()
            .enumerate()
            .map(|(i, v)| {
                let o = as_object(v, name)?.clone();
                Ok((int_or(&o, "ord", i as i64), o))
            })
            .collect::<Result<_>>()?;
        // Anki keeps these in `ord` order; sort in case a file doesn't.
        items.sort_by_key(|(ord, _)| *ord);
        Ok(items.into_iter().map(|(_, o)| o).collect())
    };
    let s = |o: &Map<String, Value>, k: &str| str_of(o, k).unwrap_or_default().to_owned();
    Ok(Notetype {
        id: id_of(key, m)?,
        name: s(m, "name"),
        cloze: int_or(m, "type", 0) == 1,
        original_stock_kind: opt_int(m, "originalStockKind"),
        css: s(m, "css"),
        sort_field_idx: int_or(m, "sortf", 0),
        fields: list("flds")?.iter().map(|f| s(f, "name")).collect(),
        templates: list("tmpls")?
            .iter()
            .map(|t| (s(t, "name"), s(t, "qfmt"), s(t, "afmt")))
            .collect(),
    })
}

fn steps(section: &Map<String, Value>) -> Vec<f64> {
    section
        .get("delays")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_f64)
                .filter(|f| f.is_finite())
                .collect()
        })
        .unwrap_or_default()
}

fn copy_rows(
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
fn int(r: &Row, i: usize, what: &str) -> Result<i64> {
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
fn text(r: &Row, i: usize, what: &str) -> Result<String> {
    Ok(match r.get_ref(i).map_err(corrupt(what))? {
        ValueRef::Text(t) | ValueRef::Blob(t) => String::from_utf8_lossy(t).into_owned(),
        ValueRef::Integer(v) => v.to_string(),
        ValueRef::Real(f) => f.to_string(),
        ValueRef::Null => String::new(),
    })
}

fn parse_object(json: &str, what: &str) -> Result<Map<String, Value>> {
    match serde_json::from_str(json) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(bad(&format!("{what} is not an object"))),
        Err(e) => Err(bad(&format!("{what}: {e}"))),
    }
}

fn as_object<'a>(v: &'a Value, what: &str) -> Result<&'a Map<String, Value>> {
    v.as_object()
        .ok_or_else(|| bad(&format!("{what} is not an object")))
}

/// Prefers the object's own `id`; falls back to its key in the parent map.
fn id_of(key: &str, o: &Map<String, Value>) -> Result<i64> {
    opt_int(o, "id")
        .or_else(|| key.parse().ok())
        .ok_or_else(|| bad(&format!("no usable id for {key}")))
}

fn opt_int(o: &Map<String, Value>, k: &str) -> Option<i64> {
    match o.get(k)? {
        Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_f64().filter(|f| f.is_finite()).map(|f| f as i64)),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

fn int_or(o: &Map<String, Value>, k: &str, default: i64) -> i64 {
    opt_int(o, k).unwrap_or(default)
}

fn str_of<'a>(o: &'a Map<String, Value>, k: &str) -> Option<&'a str> {
    o.get(k).and_then(Value::as_str)
}

fn bad(detail: &str) -> ImportError {
    ImportError::Corrupt(detail.to_owned())
}
