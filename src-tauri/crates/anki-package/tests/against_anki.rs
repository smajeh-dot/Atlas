//! Every real package decodes to a staging database that matches what Anki's
//! own library read from the same file.

mod common;

use anki_package::SourceFormat;
use common::*;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};

fn check_against_anki(name: &str, format: SourceFormat) {
    let exp = expected(name);
    let (work, prepared) = prepare_fixture(name);
    let db = open(&prepared);
    assert_eq!(prepared.format, format);

    // meta
    assert_eq!(meta(&db, "staging_version"), "1");
    assert_eq!(meta(&db, "source_format"), format.as_str());
    let package_version = exp["package"]["meta_version"]
        .as_i64()
        .map(|v| v.to_string())
        .unwrap_or_default();
    assert_eq!(meta(&db, "package_version"), package_version);
    assert_eq!(
        meta(&db, "collection_entry"),
        exp["package"]["collection_entry"].as_str().unwrap()
    );
    let schema = if format == SourceFormat::Modern {
        "18"
    } else {
        "11"
    };
    assert_eq!(meta(&db, "anki_schema"), schema);
    assert_eq!(meta(&db, "anki_crt"), exp["collection"]["crt"].to_string());
    assert_eq!(
        meta(&db, "anki_rollover_hour"),
        exp["collection"]["rollover"].to_string()
    );
    assert_eq!(
        meta(&db, "anki_sched_ver"),
        exp["collection"]["sched_ver"].to_string()
    );
    let sha = meta(&db, "source_sha256");
    assert!(
        sha.len() == 64 && sha.chars().all(|c| c.is_ascii_hexdigit()),
        "{sha}"
    );

    // decks
    let decks = rows(
        &db,
        "SELECT id, name_path, is_filtered, config_id FROM deck ORDER BY id",
    );
    let want: Vec<Vec<Value>> = exp["decks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| {
            vec![
                d["id"].clone(),
                d["name"].clone(),
                json!(d["filtered"].as_bool().unwrap() as i64),
                d["config_id"].clone(),
            ]
        })
        .collect();
    assert_eq!(decks, want, "{name}: decks");

    // deck configs
    let configs = rows(
        &db,
        "SELECT id, name, new_per_day, reviews_per_day, learn_steps_min_json, relearn_steps_min_json, desired_retention
         FROM deck_config ORDER BY id",
    );
    assert_eq!(configs.len(), exp["deck_configs"].as_array().unwrap().len());
    for (got, want) in configs.iter().zip(exp["deck_configs"].as_array().unwrap()) {
        assert_eq!(got[0], want["id"]);
        assert_eq!(got[1], want["name"]);
        assert_eq!(got[2], want["new_per_day"]);
        assert_eq!(got[3], want["reviews_per_day"]);
        assert_eq!(json(&got[4]), want["learn_steps_min"]);
        assert_eq!(json(&got[5]), want["relearn_steps_min"]);
        assert_eq!(
            got[6], want["desired_retention"],
            "{name}: retention of {}",
            want["name"]
        );
    }

    // note types
    let notetypes = rows(
        &db,
        "SELECT id, name, kind, original_stock_kind, css, sort_field_idx FROM notetype ORDER BY id",
    );
    assert_eq!(notetypes.len(), exp["notetypes"].as_array().unwrap().len());
    for (got, want) in notetypes.iter().zip(exp["notetypes"].as_array().unwrap()) {
        let kind = if want["type"] == 1 {
            "cloze"
        } else {
            "standard"
        };
        assert_eq!(
            got[..6],
            [
                want["id"].clone(),
                want["name"].clone(),
                json!(kind),
                want["original_stock_kind"].clone(),
                want["css"].clone(),
                want["sort_field_idx"].clone()
            ]
        );
        let id = want["id"].as_i64().unwrap();
        let fields: Vec<Value> = rows(
            &db,
            &format!("SELECT name FROM field WHERE notetype_id = {id} ORDER BY ord"),
        )
        .into_iter()
        .map(|r| r[0].clone())
        .collect();
        assert_eq!(Value::from(fields), want["fields"]);
        let templates: Vec<Value> = rows(
            &db,
            &format!("SELECT name, qfmt, afmt FROM template WHERE notetype_id = {id} ORDER BY ord"),
        )
        .into_iter()
        .map(|r| json!({"name": r[0], "qfmt": r[1], "afmt": r[2]}))
        .collect();
        assert_eq!(Value::from(templates), want["templates"]);
    }

    // notes
    let notes = rows(
        &db,
        "SELECT id, guid, notetype_id, mod_secs, tags_json, fields_json FROM note ORDER BY id",
    );
    let want_notes = exp["notes"].as_array().unwrap();
    assert_eq!(notes.len(), want_notes.len());
    for (got, want) in notes.iter().zip(want_notes) {
        assert_eq!(
            got[..4],
            [
                want["id"].clone(),
                want["guid"].clone(),
                want["notetype_id"].clone(),
                want["mod"].clone()
            ]
        );
        assert_eq!(json(&got[4]), want["tags"]);
        assert_eq!(json(&got[5]), want["fields"]);
    }

    // cards
    let cols = [
        "id",
        "note_id",
        "deck_id",
        "orig_deck_id",
        "ord",
        "type",
        "queue",
        "due",
        "ivl",
        "factor",
        "reps",
        "lapses",
        "left",
        "odue",
        "flags",
    ];
    let cards = rows(
        &db,
        &format!("SELECT {}, fsrs_s, fsrs_d, fsrs_dr, fsrs_decay, data_lrt, data_pos FROM card ORDER BY id", cols.join(", ")),
    );
    let want_cards = exp["cards"].as_array().unwrap();
    assert_eq!(cards.len(), want_cards.len());
    for (got, want) in cards.iter().zip(want_cards) {
        for (i, col) in cols.iter().enumerate() {
            assert_eq!(
                got[i], want[*col],
                "{name}: card {} column {col}",
                want["id"]
            );
        }
        let data: Value =
            serde_json::from_str(want["data"].as_str().unwrap()).unwrap_or(Value::Null);
        for (i, key) in ["s", "d", "dr", "decay", "lrt", "pos"].iter().enumerate() {
            let want_v = data.get(key).cloned().unwrap_or(Value::Null);
            assert_eq!(
                got[15 + i],
                want_v,
                "{name}: card {} data.{key}",
                want["id"]
            );
        }
    }

    // review log
    let revlog = rows(
        &db,
        "SELECT id, card_id, ease, ivl, last_ivl, factor, time_ms, type FROM revlog ORDER BY id",
    );
    let want_revlog: Vec<Vec<Value>> = exp["revlog"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            [
                "id", "card_id", "ease", "ivl", "last_ivl", "factor", "time", "type",
            ]
            .iter()
            .map(|k| r[*k].clone())
            .collect()
        })
        .collect();
    assert_eq!(revlog, want_revlog, "{name}: revlog");

    // media: names, sizes and hashes match, and the staged bytes are the real ones
    let media = rows(
        &db,
        "SELECT name, size, sha1, staged_path FROM media ORDER BY name",
    );
    let mut want_media: Vec<&Value> = exp["media"].as_array().unwrap().iter().collect();
    want_media.sort_by_key(|m| m["name"].as_str().unwrap().to_owned());
    assert_eq!(media.len(), want_media.len());
    for (got, want) in media.iter().zip(want_media) {
        assert_eq!(
            got[..3],
            [
                want["name"].clone(),
                want["size"].clone(),
                want["sha1"].clone()
            ]
        );
        let staged = got[3].as_str().unwrap();
        assert!(
            staged.starts_with("media/") && staged[6..].chars().all(|c| c.is_ascii_digit()),
            "{staged}"
        );
        let bytes = std::fs::read(work.path().join(staged)).unwrap();
        let sha: String = Sha1::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(Value::from(sha), want["sha1"]);
    }

    let c = prepared.counts;
    assert_eq!(
        (c.decks, c.notes, c.cards, c.revlog, c.media),
        (
            decks.len() as u64,
            notes.len() as u64,
            cards.len() as u64,
            revlog.len() as u64,
            media.len() as u64
        )
    );
    // The decoded collection copy is removed once read.
    assert!(!work.path().join("collection.sqlite").exists());
}

#[test]
fn rich_legacy2_matches_anki() {
    check_against_anki("rich-legacy2", SourceFormat::Legacy2);
}

#[test]
fn rich_legacy1_matches_anki() {
    check_against_anki("rich-legacy1", SourceFormat::Legacy1);
}

#[test]
fn fsrs_legacy2_matches_anki() {
    check_against_anki("fsrs-legacy2", SourceFormat::Legacy2);
}

#[test]
fn rich_modern_matches_anki() {
    check_against_anki("rich-modern", SourceFormat::Modern);
}

#[test]
fn rich_modern_without_scheduling_matches_anki() {
    check_against_anki("rich-modern-nosched", SourceFormat::Modern);
}

#[test]
fn fsrs_modern_matches_anki() {
    check_against_anki("fsrs-modern", SourceFormat::Modern);
}

#[test]
fn fsrs_memory_state_comes_through() {
    for name in ["fsrs-legacy2", "fsrs-modern"] {
        fsrs_memory_state_comes_through_in(name);
    }
}

fn fsrs_memory_state_comes_through_in(name: &str) {
    let (_work, prepared) = prepare_fixture(name);
    let db = open(&prepared);
    let with_state: i64 = db
        .query_row(
            "SELECT count(*) FROM card WHERE fsrs_s > 0 AND fsrs_d BETWEEN 1 AND 10",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let reviewed: i64 = db
        .query_row("SELECT count(*) FROM card WHERE reps > 0", [], |r| r.get(0))
        .unwrap();
    assert!(reviewed > 0);
    assert_eq!(with_state, reviewed);
}

const SAME_CONTENT: [&str; 9] = [
    "SELECT * FROM deck ORDER BY id",
    "SELECT * FROM deck_config ORDER BY id",
    "SELECT * FROM notetype ORDER BY id",
    "SELECT * FROM field ORDER BY notetype_id, ord",
    "SELECT * FROM template ORDER BY notetype_id, ord",
    "SELECT * FROM note ORDER BY id",
    "SELECT * FROM card ORDER BY id",
    "SELECT * FROM revlog ORDER BY id",
    // Zip entry numbers differ between layouts; names and bytes must not.
    "SELECT name, original_name, size, sha1 FROM media ORDER BY name",
];

fn assert_same_content(a: &str, b: &str) {
    let (_a, one) = prepare_fixture(a);
    let (_b, two) = prepare_fixture(b);
    let (one, two) = (open(&one), open(&two));
    for sql in SAME_CONTENT {
        assert_eq!(rows(&one, sql), rows(&two, sql), "{a} vs {b}: {sql}");
    }
}

#[test]
fn every_layout_of_one_collection_stages_the_same_content() {
    assert_same_content("rich-legacy1", "rich-legacy2");
    assert_same_content("rich-legacy2", "rich-modern");
    assert_same_content("fsrs-legacy2", "fsrs-modern");
}
