import { BUILTIN_NOTE_TYPES } from '../core/builtins';
import { DEFAULT_PRESET, DEFAULT_SETTINGS } from '../core/model';
import type { Db, Statement } from './db';

export const SCHEMA_VERSION = 2;

const V1_SCHEMA = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE presets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL)`,
  `CREATE TABLE decks (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES decks(id) ON DELETE CASCADE,
    preset_id INTEGER NOT NULL REFERENCES presets(id),
    colour INTEGER,
    position INTEGER NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'normal',
    filter TEXT,
    created_at INTEGER NOT NULL)`,
  `CREATE TABLE note_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    builtin TEXT,
    fields TEXT NOT NULL,
    templates TEXT NOT NULL,
    css TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL)`,
  `CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    guid TEXT NOT NULL UNIQUE,
    note_type_id INTEGER NOT NULL REFERENCES note_types(id),
    fields TEXT NOT NULL,
    sort_field TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT ' ',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL)`,
  `CREATE TABLE cards (
    id INTEGER PRIMARY KEY,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL,
    deck_id INTEGER NOT NULL REFERENCES decks(id),
    original_deck_id INTEGER,
    state INTEGER NOT NULL,
    due_at INTEGER,
    new_position INTEGER,
    stability REAL NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 0,
    scheduled_days REAL NOT NULL DEFAULT 0,
    learning_steps INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    last_review_at INTEGER,
    suspended INTEGER NOT NULL DEFAULT 0,
    buried_day INTEGER,
    buried_kind TEXT,
    flag INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (note_id, ord))`,
  `CREATE INDEX cards_deck_due ON cards(deck_id, state, due_at)`,
  `CREATE INDEX cards_new ON cards(deck_id, new_position) WHERE state = 0`,
  `CREATE INDEX cards_note ON cards(note_id)`,
  `CREATE TABLE revlog (
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,
    state_before INTEGER NOT NULL,
    due_before INTEGER,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    elapsed_days REAL NOT NULL,
    scheduled_days REAL NOT NULL,
    duration_ms INTEGER NOT NULL,
    kind INTEGER NOT NULL)`,
  `CREATE INDEX revlog_card ON revlog(card_id)`,
];

function v1(now: number): Statement[] {
  return [
    ...V1_SCHEMA.map((sql) => ({ sql })),
    { sql: `INSERT INTO meta (key, value) VALUES ('created_at', ?)`, params: [String(now)] },
    { sql: `INSERT INTO meta (key, value) VALUES ('settings', ?)`, params: [JSON.stringify(DEFAULT_SETTINGS)] },
    { sql: `INSERT INTO presets (id, name, config) VALUES (1, 'Default', ?)`, params: [JSON.stringify(DEFAULT_PRESET)] },
    ...BUILTIN_NOTE_TYPES.map((t) => ({
      sql: `INSERT INTO note_types (name, kind, builtin, fields, templates, css, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [t.name, t.kind, t.builtin, JSON.stringify(t.fields), JSON.stringify(t.templates), t.css, now, now],
    })),
  ];
}

/**
 * v2: Anki import. Everything an import adds is tagged with its batch, so a
 * failed or cancelled import can be removed exactly, and media gets a table so
 * files can be shared between notes and checked for collisions. Additive and
 * nullable only: v1 rows are untouched.
 */
function v2(): Statement[] {
  return [
    `CREATE TABLE import_batches (
      id INTEGER PRIMARY KEY,
      source_name TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('running', 'complete')),
      summary TEXT)`,
    `CREATE TABLE media (
      name TEXT PRIMARY KEY COLLATE NOCASE,
      sha1 TEXT NOT NULL,
      size INTEGER NOT NULL,
      import_batch_id INTEGER REFERENCES import_batches(id))`,
    ...['notes', 'cards', 'decks', 'note_types', 'presets'].map(
      (t) => `ALTER TABLE ${t} ADD COLUMN import_batch_id INTEGER REFERENCES import_batches(id)`,
    ),
    `CREATE INDEX notes_import_batch ON notes(import_batch_id) WHERE import_batch_id IS NOT NULL`,
    `CREATE INDEX cards_import_batch ON cards(import_batch_id) WHERE import_batch_id IS NOT NULL`,
    `CREATE INDEX media_import_batch ON media(import_batch_id) WHERE import_batch_id IS NOT NULL`,
  ].map((sql) => ({ sql }));
}

const MIGRATIONS: ((now: number) => Statement[])[] = [v1, v2];

async function currentVersion(db: Db): Promise<number> {
  const hasMeta = await db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'`);
  if (hasMeta.length === 0) return 0;
  const [row] = await db.query<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`);
  return row ? Number(row.value) : 0;
}

/** Brings the database up to SCHEMA_VERSION (or `target`, for tests). Safe to call on every launch. */
export async function migrate(db: Db, now: number, target: number = MIGRATIONS.length): Promise<void> {
  const from = await currentVersion(db);
  for (let v = from + 1; v <= target; v++) {
    await db.batch([
      ...MIGRATIONS[v - 1]!(now),
      { sql: `INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)`, params: [String(v)] },
    ]);
  }
}
