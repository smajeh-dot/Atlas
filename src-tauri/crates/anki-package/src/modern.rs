//! Reads schema-18 collections (`collection.anki21b`, Anki 2.1.50+). Note
//! types, fields, templates, decks and deck options are rows of their own
//! tables, with settings in protobuf blobs. Field numbers below come from
//! Anki's notetypes.proto, decks.proto and deck_config.proto, as checked
//! against the `anki` 26.9.4 Python package (see tests/fixtures/anki/README.md).

use std::collections::HashMap;

use rusqlite::Connection;

use crate::collection::{blob, copy_rows, int, text, Counts};
use crate::error::Result;
use crate::proto::Message;
use crate::staging::{DeckConfig, Notetype, Staging};

pub(crate) fn read_metadata(src: &Connection, st: &Staging, counts: &mut Counts) -> Result<()> {
    // `config` holds JSON values; only the day-boundary settings matter here.
    let mut config: HashMap<String, serde_json::Value> = HashMap::new();
    copy_rows(src, "SELECT KEY, val FROM config", "config", |r| {
        let key = text(r, 0, "config.key")?;
        if matches!(key.as_str(), "rollover" | "creationOffset" | "schedVer") {
            if let Ok(v) = serde_json::from_slice(&blob(r, 1, "config.val")?) {
                config.insert(key, v);
            }
        }
        Ok(())
    })?;
    let num = |k: &str| config.get(k).and_then(serde_json::Value::as_i64);
    // Anki leaves `rollover` unset while it's still the default.
    st.meta(
        "anki_rollover_hour",
        &num("rollover").unwrap_or(4).to_string(),
    )?;
    st.meta(
        "anki_creation_offset",
        &num("creationOffset")
            .map(|v| v.to_string())
            .unwrap_or_default(),
    )?;
    st.meta(
        "anki_sched_ver",
        &num("schedVer").map(|v| v.to_string()).unwrap_or_default(),
    )?;

    let mut fields: HashMap<i64, Vec<String>> = HashMap::new();
    copy_rows(
        src,
        "SELECT ntid, name FROM fields ORDER BY ntid, ord",
        "fields",
        |r| {
            fields
                .entry(int(r, 0, "fields.ntid")?)
                .or_default()
                .push(text(r, 1, "fields.name")?);
            Ok(())
        },
    )?;
    let mut templates: HashMap<i64, Vec<(String, String, String)>> = HashMap::new();
    copy_rows(
        src,
        "SELECT ntid, name, config FROM templates ORDER BY ntid, ord",
        "templates",
        |r| {
            // Notetype.Template.Config: q_format = 1, a_format = 2.
            let cfg = blob(r, 2, "templates.config")?;
            let cfg = Message::parse(&cfg)?;
            templates
                .entry(int(r, 0, "templates.ntid")?)
                .or_default()
                .push((
                    text(r, 1, "templates.name")?,
                    cfg.string(1)?,
                    cfg.string(2)?,
                ));
            Ok(())
        },
    )?;

    counts.notetypes = copy_rows(
        src,
        "SELECT id, name, config FROM notetypes",
        "notetypes",
        |r| {
            let id = int(r, 0, "notetypes.id")?;
            // Notetype.Config: kind = 1 (0 normal, 1 cloze), sort_field_idx = 2,
            // css = 3, original_stock_kind = 9 (6 is Image Occlusion).
            let cfg = blob(r, 2, "notetypes.config")?;
            let cfg = Message::parse(&cfg)?;
            let stock = cfg.uint(9)? as i64;
            st.notetype(&Notetype {
                id,
                name: text(r, 1, "notetypes.name")?,
                cloze: cfg.uint(1)? == 1,
                // proto3 can't tell "unknown" from absent; legacy files omit it. Match them.
                original_stock_kind: (stock != 0).then_some(stock),
                css: cfg.string(3)?,
                sort_field_idx: cfg.uint(2)? as i64,
                fields: fields.remove(&id).unwrap_or_default(),
                templates: templates.remove(&id).unwrap_or_default(),
            })
        },
    )?;

    counts.decks = copy_rows(src, "SELECT id, name, kind FROM decks", "decks", |r| {
        // Deck.KindContainer: normal = 1 (Normal.config_id = 1), filtered = 2.
        let kind = blob(r, 2, "decks.kind")?;
        let kind = Message::parse(&kind)?;
        let filtered = kind.has(2);
        let config_id = match kind.message(1)? {
            Some(normal) if !filtered => Some(normal.int64(1)?),
            _ => None,
        };
        // Schema 18 separates deck levels with \x1f; Anki shows them joined by "::".
        let name = text(r, 1, "decks.name")?.replace('\x1f', "::");
        st.deck(int(r, 0, "decks.id")?, &name, filtered, config_id)
    })?;

    counts.deck_configs = copy_rows(
        src,
        "SELECT id, name, config FROM deck_config",
        "deck_config",
        |r| {
            // DeckConfig.Config: learn_steps = 1, relearn_steps = 2, new_per_day = 9,
            // reviews_per_day = 10, desired_retention = 37.
            let cfg = blob(r, 2, "deck_config.config")?;
            let cfg = Message::parse(&cfg)?;
            st.deck_config(&DeckConfig {
                id: int(r, 0, "deck_config.id")?,
                name: text(r, 1, "deck_config.name")?,
                new_per_day: cfg.uint(9)? as i64,
                reviews_per_day: cfg.uint(10)? as i64,
                learn_steps_min: cfg.floats(1)?,
                relearn_steps_min: cfg.floats(2)?,
                desired_retention: cfg.float(37)?.filter(|r| *r > 0.0),
            })
        },
    )?;
    Ok(())
}
