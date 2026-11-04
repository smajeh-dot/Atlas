//! Reads schema-11 collections (`collection.anki2` and `collection.anki21`).
//! Note types, decks and deck configs are JSON strings in the single `col` row.

use rusqlite::Connection;
use serde_json::{Map, Value};

use crate::collection::{bad, Counts};
use crate::error::{corrupt, Result};
use crate::staging::{DeckConfig, Notetype, Staging};

pub(crate) fn read_metadata(src: &Connection, st: &Staging, counts: &mut Counts) -> Result<()> {
    let (conf, models, decks, dconf): (String, String, String, String) = src
        .query_row("SELECT conf, models, decks, dconf FROM col", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(corrupt("col row"))?;
    let conf = parse_object(&conf, "col.conf")?;
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
