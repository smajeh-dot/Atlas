//! Writes the staging database described by `staging.sql`.

use std::path::Path;

use rusqlite::{params, Connection};

use crate::error::{staging, Result};

pub const STAGING_SCHEMA: &str = include_str!("../staging.sql");
pub const STAGING_VERSION: &str = "1";

pub(crate) struct Notetype {
    pub id: i64,
    pub name: String,
    pub cloze: bool,
    pub original_stock_kind: Option<i64>,
    pub css: String,
    pub sort_field_idx: i64,
    pub fields: Vec<String>,
    /// (name, qfmt, afmt), in template order.
    pub templates: Vec<(String, String, String)>,
}

pub(crate) struct DeckConfig {
    pub id: i64,
    pub name: String,
    pub new_per_day: i64,
    pub reviews_per_day: i64,
    pub learn_steps_min: Vec<f64>,
    pub relearn_steps_min: Vec<f64>,
    pub desired_retention: Option<f64>,
}

pub(crate) struct Note {
    pub id: i64,
    pub guid: String,
    pub notetype_id: i64,
    pub mod_secs: i64,
    pub tags: String,
    pub fields: String,
}

/// Raw card columns, in staging order up to `flags`, plus Anki's `data` JSON.
pub(crate) struct Card {
    pub cols: [i64; 15],
    pub data: String,
}

pub(crate) struct Staging {
    conn: Connection,
}

impl Staging {
    pub fn create(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).map_err(staging)?;
        // A throwaway file: if anything fails, the whole work folder is deleted,
        // so durability would only cost time.
        conn.execute_batch("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;")
            .map_err(staging)?;
        conn.execute_batch(STAGING_SCHEMA).map_err(staging)?;
        conn.execute_batch("BEGIN").map_err(staging)?;
        let st = Self { conn };
        st.meta("staging_version", STAGING_VERSION)?;
        Ok(st)
    }

    pub fn finish(self) -> Result<()> {
        self.conn.execute_batch("COMMIT").map_err(staging)?;
        self.conn.close().map_err(|(_, e)| staging(e))
    }

    pub fn meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn
            .prepare_cached("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)")
            .and_then(|mut s| s.execute(params![key, value]))
            .map_err(staging)?;
        Ok(())
    }

    pub fn deck(
        &self,
        id: i64,
        name_path: &str,
        filtered: bool,
        config_id: Option<i64>,
    ) -> Result<()> {
        self.conn
            .prepare_cached(
                "INSERT INTO deck (id, name_path, is_filtered, config_id) VALUES (?1, ?2, ?3, ?4)",
            )
            .and_then(|mut s| s.execute(params![id, name_path, filtered, config_id]))
            .map_err(staging)?;
        Ok(())
    }

    pub fn deck_config(&self, c: &DeckConfig) -> Result<()> {
        self.conn
            .prepare_cached(
                "INSERT INTO deck_config (id, name, new_per_day, reviews_per_day, learn_steps_min_json,
                   relearn_steps_min_json, desired_retention) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .and_then(|mut s| {
                s.execute(params![
                    c.id,
                    c.name,
                    c.new_per_day,
                    c.reviews_per_day,
                    serde_json::to_string(&c.learn_steps_min).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(&c.relearn_steps_min).unwrap_or_else(|_| "[]".into()),
                    c.desired_retention,
                ])
            })
            .map_err(staging)?;
        Ok(())
    }

    pub fn notetype(&self, n: &Notetype) -> Result<()> {
        let kind = if n.cloze { "cloze" } else { "standard" };
        self.conn
            .prepare_cached(
                "INSERT INTO notetype (id, name, kind, original_stock_kind, css, sort_field_idx)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .and_then(|mut s| {
                s.execute(params![
                    n.id,
                    n.name,
                    kind,
                    n.original_stock_kind,
                    n.css,
                    n.sort_field_idx
                ])
            })
            .map_err(staging)?;
        for (ord, name) in n.fields.iter().enumerate() {
            self.conn
                .prepare_cached("INSERT INTO field (notetype_id, ord, name) VALUES (?1, ?2, ?3)")
                .and_then(|mut s| s.execute(params![n.id, ord as i64, name]))
                .map_err(staging)?;
        }
        for (ord, (name, qfmt, afmt)) in n.templates.iter().enumerate() {
            self.conn
                .prepare_cached("INSERT INTO template (notetype_id, ord, name, qfmt, afmt) VALUES (?1, ?2, ?3, ?4, ?5)")
                .and_then(|mut s| s.execute(params![n.id, ord as i64, name, qfmt, afmt]))
                .map_err(staging)?;
        }
        Ok(())
    }

    pub fn note(&self, n: &Note) -> Result<()> {
        let tags: Vec<&str> = n.tags.split_whitespace().collect();
        let fields: Vec<&str> = n.fields.split('\x1f').collect();
        self.conn
            .prepare_cached(
                "INSERT INTO note (id, guid, notetype_id, mod_secs, tags_json, fields_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .and_then(|mut s| {
                s.execute(params![
                    n.id,
                    n.guid,
                    n.notetype_id,
                    n.mod_secs,
                    serde_json::Value::from(tags).to_string(),
                    serde_json::Value::from(fields).to_string(),
                ])
            })
            .map_err(staging)?;
        Ok(())
    }

    pub fn card(&self, c: &Card) -> Result<()> {
        let d = CardData::parse(&c.data);
        let k = &c.cols;
        self.conn
            .prepare_cached(
                "INSERT INTO card (id, note_id, deck_id, orig_deck_id, ord, type, queue, due, ivl, factor,
                   reps, lapses, left, odue, flags, fsrs_s, fsrs_d, fsrs_dr, fsrs_decay, data_lrt, data_pos)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                   ?16, ?17, ?18, ?19, ?20, ?21)",
            )
            .and_then(|mut s| {
                s.execute(params![
                    k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7], k[8], k[9], k[10], k[11], k[12], k[13],
                    k[14], d.s, d.d, d.dr, d.decay, d.lrt, d.pos,
                ])
            })
            .map_err(staging)?;
        Ok(())
    }

    pub fn revlog(&self, cols: &[i64; 8]) -> Result<()> {
        self.conn
            .prepare_cached(
                "INSERT INTO revlog (id, card_id, ease, ivl, last_ivl, factor, time_ms, type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .and_then(|mut s| s.execute(rusqlite::params_from_iter(cols.iter())))
            .map_err(staging)?;
        Ok(())
    }

    /// Returns false if the name is already staged, so the caller can decide.
    pub fn media(&self, name: &str, size: u64, sha1: &str, staged_path: &str) -> Result<bool> {
        let changed = self
            .conn
            .prepare_cached("INSERT OR IGNORE INTO media (name, size, sha1, staged_path) VALUES (?1, ?2, ?3, ?4)")
            .and_then(|mut s| s.execute(params![name, size as i64, sha1, staged_path]))
            .map_err(staging)?;
        Ok(changed == 1)
    }
}

/// The parts of Anki's per-card `data` JSON that matter for scheduling.
/// Malformed or missing data is normal in older files and simply yields NULLs.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct CardData {
    pub s: Option<f64>,
    pub d: Option<f64>,
    pub dr: Option<f64>,
    pub decay: Option<f64>,
    pub lrt: Option<i64>,
    pub pos: Option<i64>,
}

impl CardData {
    pub fn parse(text: &str) -> Self {
        let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(text)
        else {
            return Self::default();
        };
        let float = |k: &str| {
            map.get(k)
                .and_then(|v| v.as_f64())
                .filter(|f| f.is_finite())
        };
        let int = |k: &str| {
            map.get(k).and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64))
            })
        };
        Self {
            s: float("s"),
            d: float("d"),
            dr: float("dr"),
            decay: float("decay"),
            lrt: int("lrt"),
            pos: int("pos"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn card_data_reads_fsrs_fields() {
        let d = CardData::parse(
            r#"{"pos":1,"s":67.1525,"d":2.09,"dr":0.9,"decay":0.154,"lrt":1793821427}"#,
        );
        assert_eq!(d.s, Some(67.1525));
        assert_eq!(d.d, Some(2.09));
        assert_eq!(d.dr, Some(0.9));
        assert_eq!(d.decay, Some(0.154));
        assert_eq!(d.lrt, Some(1_793_821_427));
        assert_eq!(d.pos, Some(1));
    }

    #[test]
    fn card_data_tolerates_junk() {
        for text in ["", "{}", "null", "[1,2]", "{\"s\":\"big\"}", "not json"] {
            assert_eq!(CardData::parse(text), CardData::default(), "{text}");
        }
    }
}
