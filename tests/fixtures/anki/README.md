# Anki package fixtures

Real `.apkg` files written by Anki's own exporter (the official `anki` Python
package, version 26.9.4), for testing the importer. Hostile or broken archives
are not here: tests build those in code, next to the rule each one breaks.

Every `<name>.apkg` has a `<name>.expected.json` beside it. The generator makes
that file by opening the collection *inside the package* with Anki's own library,
so it records what Anki thinks the package holds. Compare against it rather than
copying numbers into tests by hand.

## The files

| File | Layout | Contents |
|---|---|---|
| `rich-modern.apkg` | Modern: `meta` v3, zstd `collection.anki21b`, dummy `collection.anki2` | Everything below, with scheduling |
| `rich-legacy2.apkg` | "Support older Anki versions": `meta` v2, `collection.anki21`, dummy `collection.anki2` | Same collection |
| `rich-legacy1.apkg` | Pre-2.1.50: no `meta`, real data in `collection.anki2`, no dummy | Same collection (see limits below) |
| `rich-modern-nosched.apkg` | Modern | Same notes, exported without scheduling |
| `fsrs-modern.apkg` | Modern | Six cards reviewed with FSRS on |
| `fsrs-legacy2.apkg` | Legacy v2 | Same FSRS collection |
| `dummy-only.apkg` | Only the placeholder `collection.anki2` | Atlas must refuse this with the "export again" message |

The rich collection contains:

- **Note types:** Basic; Basic (and reversed card); Basic (optional reversed card), with and without the reverse; Basic (type in the answer); Cloze (`c1`+`c2` on one note, and a note with only `c3`); Image Occlusion; and a custom "Chem Reaction" type with two templates, `{{#…}}`, `{{^…}}`, `{{hint:…}}`, an unsupported `{{furigana:…}}`, and CSS that references `_bg-tile.png`.
- **Decks:** `Chem::Organic::Alkanes`, `Chem::Inorganic` (preset "Exam cram": 50 new, 500 reviews, retention 0.85), `Chem::States`, `Chem::Interday` (preset "Interday steps": learning 10m and 1d, relearning 10m and 2d), an empty `Default`, and a filtered deck `Cram`. The generator also makes an empty `Chem::Empty`, but Anki doesn't export decks that have no cards, so it isn't in the packages.
- **Fields:** `<sub>` HTML; an image with a quoted `src`; an unquoted `src=café.png`; `[sound:benzene.mp3]`; a reference to a missing file; `[latex]`, `\(…\)` and `\[…\]`; `onerror=`, `<script>` and `javascript:`; non-ASCII text.
- **Tags:** `chem::organic`, `Säure`, `Exam_2026` and others.
- **Card states** (`Chem::States`, one note each, with real multi-week histories):

| Card | State on export day |
|---|---|
| 01 | Review, answered today, due in the future |
| 02 | Relearning (answered Again today) |
| 03 | Review, suspended |
| 04 | Review, overdue, red flag |
| 05 | Review, due today via "Set due date", blue flag |
| 06 | Review, user-buried, purple flag (flag 7, the highest) |
| 07 | Lapsed review, moved into the filtered deck `Cram` |
| 08 | Review, pushed into the future by "Set due date" |
| 09 | Learning (one step done) |
| 10 | New, buried as a sibling |
| 11 | New, suspended |
| 12, 13 | New |
| 14 | "Forgotten": new again, but keeps reps and history |
| Interday learner | Learning on a 1-day step (queue 3) |

The `Formula of methane` card (new) is also in `Cram`.

## `expected.json`

- `package`: zip entry names in order, `meta_version` (`null` if no `meta`), which entry holds the collection, whether a dummy is present.
- `generated`: `now_ms` (the moment of export), `anki_today` (Anki's day number at that moment, which the package does not store), `tz` (`Europe/London`, same as `tests/setup.ts`), Anki version. Due-date tests should use `now_ms` as their clock and check against `anki_today`.
- `collection`: `crt`, `rollover`, `sched_ver`, `fsrs`.
- `decks`, `deck_configs`, `notetypes`: as Anki reports them (deck names joined with `::`).
- `notes`, `cards`, `revlog`: raw column values, ordered by id.
- `media`: manifest name, zip entry, size and SHA-1 of the decompressed bytes.

## Regenerating

Anki stamps ids with the clock, so regenerating changes every id and date.
Always commit each `.apkg` together with its `.expected.json`.

Run the generator on Linux (the cloud sandbox or WSL). It pins the time zone with
`time.tzset()`, which does nothing on Windows. From the repository root:

```bash
python3 -m venv /tmp/ankivenv
```

```bash
/tmp/ankivenv/bin/pip install -r scripts/anki-fixtures/requirements.txt
```

```bash
/tmp/ankivenv/bin/python scripts/anki-fixtures/make_fixtures.py tests/fixtures/anki
```

Don't commit the venv or the wheel.

## Format findings (checked against these files, Anki 26.9.4)

These replace the "VERIFY" guesses in the importer plan. Anything still marked
**VERIFY** was not checked.

**Package layout**

1. **Modern** (`meta` = `08 03`): every zip entry is *stored* (no zip compression), and each entry's bytes are zstd-compressed one by one: `collection.anki21b`, the `media` manifest and every media file. Each zstd frame starts `28 b5 2f fd`.
2. **Legacy v2** (`meta` = `08 02`): entries are deflated; `collection.anki21` is plain SQLite, `media` is JSON `{"0": "name", …}`, and media files are raw.
3. **Legacy v1**: no `meta`, and the real data is in `collection.anki2`. Modern Anki can't write this layout any more, so `rich-legacy1.apkg` is a real v2 export repackaged that way.
4. **Dummy:** the modern and v2 layouts also contain a 51,200-byte placeholder `collection.anki2` (schema 11) with one note whose first field is `Please update to the latest Anki version, then import the .colpkg/.apkg file again.` Prefer `anki21b`, then `anki21`, then `anki2`. If only `anki2` is present and its single note is this text, refuse.
5. **`meta`** is protobuf `PackageMetadata { Version version = 1; }`, with `1` = LEGACY_1, `2` = LEGACY_2, `3` = LATEST. A missing `meta` means legacy v1.
6. **Modern media manifest:** zstd-compressed protobuf `MediaEntries { repeated MediaEntry entries = 1; }`, where `MediaEntry { string name = 1; uint32 size = 2; bytes sha1 = 3; optional uint32 legacy_zip_filename = 255; }`. The zip entry for list item *i* is named `i`. Field 255 doesn't appear in these files (**VERIFY** where it's used).
7. **The same collection gets different index → name mappings in different layouts.** Always resolve files through the manifest, never by position.

**Collection databases**

8. **Modern** (`ver` 18): the `col` row's `models`, `decks`, `dconf` and `tags` are empty strings. Note types, fields, templates, decks, deck configs, config and tags live in their own tables, with protobuf `config`/`common`/`kind` blobs. Deck names are joined with `\x1f`. `config.val` holds JSON bytes.
9. **Trap: `COLLATE unicase`.** Name columns in `notetypes`, `fields`, `templates`, `decks`, `deck_config` and `tags` use a custom collation that plain SQLite doesn't have. Any query that uses one of those indexes fails: Python's `sqlite3` gives `no query solution` on `SELECT * FROM tags`. The queries Atlas runs don't happen to need it, but the reader registers a `unicase` collation (case-insensitive Unicode comparison) anyway, in case SQLite picks one of those indexes.
10. **Legacy** (`ver` 11): note types, decks and deck configs are JSON in the `col` row. `conf` omits `rollover` when it's the default; treat a missing value as `4`.
11. Parent decks are real rows (`Chem`, `Chem::Organic`). An empty `Default` (id 1) is always present, but other decks with no cards (`Chem::Empty`) are left out of the export.

**Cards** (v3 scheduler, as exported)

12. New: `type 0`, `queue 0`, `due` = new-card position.
13. Learning: `type 1`, `queue 1`, `due` in epoch **seconds**. `left` holds only the steps remaining (it is `1` after the first Good with two steps); there was no ×1000 "today" part in these files. Older files may have one, so use `left % 1000`.
14. Interday learning: `type 1`, `queue 3`, `due` = day number.
15. Review: `type 2`, `queue 2`, `due` = day number relative to `crt`.
16. Relearning: `type 3`, `queue 1`, `due` in epoch seconds, plus `left`.
17. Suspended (`queue -1`) and buried (`-3` by the user, `-2` as a sibling) keep their `type`, `due` and `ivl`.
18. `flags & 7` ranges over 1–7 (red, orange, green, blue, pink, turquoise, purple). Atlas uses the same seven numbers and colours (`setFlag` in `studySession.ts`), so copy the value across unchanged.
19. **Filtered decks:** `did` = the filtered deck and `odid` = the home deck. `due` becomes `-100000 + n` (the card's place in the filtered deck), and the real due is in `odue` (a day number for review cards, a position for new cards). Always use `odue`/`odid` when `odid != 0`.
20. **"Forget"** leaves a card with `type 0`/`queue 0` but keeps `reps`, `lapses` and its history. New cards can have reviews.
21. `cards.data` is JSON. It has `pos` (original new position) and `lrt` (last review, epoch seconds), and with FSRS also `s`, `d`, `dr` and `decay` (FSRS-6). Example: `{"pos":1,"s":67.1525,"d":2.09,"dr":0.9,"decay":0.154,"lrt":…}`.
22. **Trap: the global FSRS switch is not in the package.** `fsrs-*.expected.json` shows `fsrs: false` although every reviewed card has `s`/`d`. Decide FSRS per card from `data`.

**Review log**

23. `type`: 0 learn, 1 review, 2 relearn, 4 manual. "Set due date" and "Forget" both write `type 4`, `ease 0`. Type 3 (filtered, no rescheduling) isn't in these fixtures.
24. `time` is the answer duration in ms. The generator sets it explicitly, so it's non-zero.

**Without scheduling** (`rich-modern-nosched`)

25. Every card is `type 0`/`queue 0` with `reps`, `lapses`, `flags` and `ivl` at 0, and `revlog` is empty.
26. Only the `Default` deck config is exported, and every deck points at it.
27. **Filtered decks become ordinary decks that keep their cards** (`odid 0`), so `Cram` arrives as a normal deck.
28. `cards.data` can still carry a stale `lrt`. Ignore it when a card has no history.

**Day numbers**

29. **Trap: don't compute "today" as `floor((now - crt) / 86400)`.** `crt` was set at the rollover hour on the creation day; once a DST change has passed it no longer falls at the rollover hour local time (in `rich-*`, `crt` is 05:00 BST). Anki works from calendar days plus the rollover hour. Test every conversion against `generated.anki_today` (**VERIFY** the exact rule in rslib `scheduler/timing.rs`).

**Note types and media**

30. Image Occlusion is `type 1` (cloze) with `originalStockKind 6`. **Trap:** a custom type made with `models.new()` gets `originalStockKind 1`, so stock kind doesn't identify built-ins; match on structure instead.
31. Files used only by templates or CSS are exported only if their names start with `_` (`_bg-tile.png`). A file referenced in a field but missing from the collection is simply absent from the package.
32. Anki writes media names NFC-normalised (`café.png`).

**Not covered by these fixtures**

- Anki 2.0 / v1-scheduler semantics (for example, relearning stored as `type 2`, `queue 1`). Modern Anki can't produce them, and `rich-legacy1` tests only the container.
- Revlog `type 3`, `legacy_zip_filename`, packages from AnkiDroid or AnkiWeb shared decks, and large decks. The scale test generates its own data.
