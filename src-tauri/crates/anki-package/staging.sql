-- Staging database: the contract between the Rust package reader and the
-- TypeScript importer.
--
-- Rust decodes the .apkg into these tables and does nothing semantic: no
-- mapping to Atlas, no scheduling maths. Values are Anki's own, unchanged,
-- except where a comment says how they were decoded. TypeScript reads this
-- file and decides what to import.
--
-- Plain scalar columns only (no BLOBs, no protobuf) so the Atlas bridge and
-- node:sqlite can read every table. Bump meta.staging_version on any change.

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys written by the reader:
--   staging_version        '1'
--   source_format          'legacy1' | 'legacy2' | 'modern'
--   package_version        PackageMetadata.version from the `meta` entry, '' if absent
--   collection_entry       zip entry the collection came from
--   source_sha256          hex SHA-256 of the .apkg file
--   anki_schema            col.ver (11 or 18)
--   anki_crt               col.crt, epoch seconds
--   anki_rollover_hour     hour the Anki day starts; Anki's default 4 when unset
--   anki_creation_offset   minutes west of UTC when the collection was made; '' if unset
--   anki_sched_ver         1 or 2 ('' if unset)

CREATE TABLE deck (
  id          INTEGER PRIMARY KEY,
  name_path   TEXT NOT NULL,         -- levels joined with '::', as Anki shows them
  is_filtered INTEGER NOT NULL,      -- 0 or 1
  config_id   INTEGER                -- NULL for filtered decks
);

CREATE TABLE deck_config (
  id                     INTEGER PRIMARY KEY,
  name                   TEXT NOT NULL,
  new_per_day            INTEGER NOT NULL,
  reviews_per_day        INTEGER NOT NULL,
  learn_steps_min_json   TEXT NOT NULL,  -- JSON array of minutes, e.g. [1.0,10.0]
  relearn_steps_min_json TEXT NOT NULL,
  desired_retention      REAL            -- NULL if the package doesn't say
);

CREATE TABLE notetype (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('standard', 'cloze')),
  original_stock_kind INTEGER,         -- Anki's StockNotetype.Kind; 6 is Image Occlusion. NULL if absent
  css                 TEXT NOT NULL,
  sort_field_idx      INTEGER NOT NULL
);

CREATE TABLE field (
  notetype_id INTEGER NOT NULL,
  ord         INTEGER NOT NULL,
  name        TEXT NOT NULL,
  PRIMARY KEY (notetype_id, ord)
);

CREATE TABLE template (
  notetype_id INTEGER NOT NULL,
  ord         INTEGER NOT NULL,
  name        TEXT NOT NULL,
  qfmt        TEXT NOT NULL,
  afmt        TEXT NOT NULL,
  PRIMARY KEY (notetype_id, ord)
);

CREATE TABLE note (
  id          INTEGER PRIMARY KEY,     -- Anki note id: creation time in ms
  guid        TEXT NOT NULL,
  notetype_id INTEGER NOT NULL,
  mod_secs    INTEGER NOT NULL,
  tags_json   TEXT NOT NULL,           -- JSON array; Anki's space-separated tags, split
  fields_json TEXT NOT NULL            -- JSON array; Anki's \x1f-separated fields, split
);

CREATE TABLE card (
  id           INTEGER PRIMARY KEY,    -- Anki card id: creation time in ms
  note_id      INTEGER NOT NULL,
  deck_id      INTEGER NOT NULL,
  orig_deck_id INTEGER NOT NULL,       -- home deck while in a filtered deck, else 0
  ord          INTEGER NOT NULL,
  type         INTEGER NOT NULL,
  queue        INTEGER NOT NULL,
  due          INTEGER NOT NULL,
  ivl          INTEGER NOT NULL,
  factor       INTEGER NOT NULL,
  reps         INTEGER NOT NULL,
  lapses       INTEGER NOT NULL,
  left         INTEGER NOT NULL,
  odue         INTEGER NOT NULL,
  flags        INTEGER NOT NULL,
  -- Decoded from the card's `data` JSON; NULL when the key is absent or not a number.
  fsrs_s       REAL,                   -- data.s, FSRS stability
  fsrs_d       REAL,                   -- data.d, FSRS difficulty
  fsrs_dr      REAL,                   -- data.dr, desired retention used
  fsrs_decay   REAL,                   -- data.decay, FSRS-6 decay
  data_lrt     INTEGER,                -- data.lrt, last review, epoch seconds (stale after "no scheduling" exports)
  data_pos     INTEGER                 -- data.pos, original new-card position
);

CREATE TABLE revlog (
  id       INTEGER PRIMARY KEY,        -- answer time in ms
  card_id  INTEGER NOT NULL,
  ease     INTEGER NOT NULL,
  ivl      INTEGER NOT NULL,
  last_ivl INTEGER NOT NULL,
  factor   INTEGER NOT NULL,
  time_ms  INTEGER NOT NULL,
  type     INTEGER NOT NULL
);

CREATE TABLE media (
  name        TEXT PRIMARY KEY,        -- filename as the package's manifest gives it
  size        INTEGER NOT NULL,        -- bytes after decompression
  sha1        TEXT NOT NULL,           -- hex SHA-1 of those bytes
  staged_path TEXT NOT NULL            -- relative to the work folder; never derived from `name`
);

CREATE INDEX card_note ON card(note_id);
CREATE INDEX revlog_card ON revlog(card_id);
