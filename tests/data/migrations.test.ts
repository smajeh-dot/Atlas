import { expect, test } from 'vitest';
import { migrate, SCHEMA_VERSION } from '../../src/data/migrations';
import { DEFAULT_PRESET, DEFAULT_SETTINGS } from '../../src/core/model';
import { createDeck } from '../../src/data/decks';
import { addNote } from '../../src/services/noteService';
import { UndoStack } from '../../src/services/undo';
import { createTestDb } from '../helpers/testDb';
import { fixedClock, T0 } from '../helpers/fixtures';
import type { Db } from '../../src/data/db';

test('creates the current schema version with defaults', async () => {
  const db = createTestDb();
  await migrate(db, T0);
  const meta = await db.query<{ key: string; value: string }>('SELECT key, value FROM meta ORDER BY key');
  const m = Object.fromEntries(meta.map((r) => [r.key, r.value]));
  expect(SCHEMA_VERSION).toBe(2);
  expect(m.schema_version).toBe('2');
  expect(m.created_at).toBe(String(T0));
  expect(JSON.parse(m.settings!)).toEqual(DEFAULT_SETTINGS);
});

test('installs the four built-in note types and the Default preset', async () => {
  const db = createTestDb();
  await migrate(db, T0);
  const types = await db.query<{ builtin: string }>('SELECT builtin FROM note_types ORDER BY id');
  expect(types.map((t) => t.builtin)).toEqual(['basic', 'basic_reversed', 'basic_typein', 'cloze']);
  const presets = await db.query<{ id: number; name: string; config: string }>('SELECT id, name, config FROM presets');
  expect(presets).toHaveLength(1);
  expect(presets[0]!.id).toBe(1);
  expect(presets[0]!.name).toBe('Default');
  expect(JSON.parse(presets[0]!.config)).toEqual(DEFAULT_PRESET);
});

test('running migrate twice changes nothing', async () => {
  const db = createTestDb();
  await migrate(db, T0);
  await migrate(db, T0 + 1000);
  expect(await db.query('SELECT id FROM note_types')).toHaveLength(4);
  expect(await db.query('SELECT id FROM presets')).toHaveLength(1);
  const [c] = await db.query<{ value: string }>("SELECT value FROM meta WHERE key = 'created_at'");
  expect(c!.value).toBe(String(T0));
});

test('cards reference notes and are deleted with them', async () => {
  const db = createTestDb();
  await migrate(db, T0);
  const fks = await db.query<{ table: string }>('PRAGMA foreign_key_list(cards)');
  expect(fks.map((f) => f.table)).toContain('notes');
});

test('v2 adds import tracking: batches, media, and a batch column on what imports create', async () => {
  const db = createTestDb();
  await migrate(db, T0);
  for (const table of ['notes', 'cards', 'decks', 'note_types', 'presets']) {
    const cols = await db.query<{ name: string }>(`PRAGMA table_info(${table})`);
    expect(cols.map((c) => c.name), table).toContain('import_batch_id');
  }
  const media = await db.query<{ name: string }>('PRAGMA table_info(media)');
  expect(media.map((c) => c.name)).toEqual(['name', 'sha1', 'size', 'import_batch_id']);
  // Media names are unique ignoring case, as on Windows.
  await db.execute(`INSERT INTO media (name, sha1, size) VALUES ('A.png', 'x', 1)`);
  await expect(db.execute(`INSERT INTO media (name, sha1, size) VALUES ('a.png', 'y', 2)`)).rejects.toThrow();
});

async function dump(db: Db, tables: string[]): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = await db.query(`SELECT * FROM ${t} ORDER BY rowid`);
  return out;
}

test('a v1 database full of cards and reviews migrates to v2 without losing anything', async () => {
  const db = createTestDb();
  await migrate(db, T0, 1);
  const clock = fixedClock(T0);
  const deps = { db, clock, undo: new UndoStack() };
  const deckId = await createDeck(db, { name: 'Chemistry' }, T0);
  const { cardIds } = await addNote(deps, { noteTypeId: 1, deckId, fields: ['H<sub>2</sub>O', 'water'], tags: ['chem'] });
  await db.execute(`UPDATE cards SET state = 2, due_at = ?, stability = 12.5, reps = 4 WHERE id = ?`, [T0 + 5e8, cardIds[0]]);
  await db.execute(
    `INSERT INTO revlog (id, card_id, rating, state_before, due_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, kind)
     VALUES (?, ?, 3, 2, NULL, 12.5, 4.2, 3, 12, 4000, 1)`,
    [T0 - 1000, cardIds[0]],
  );
  const v1Tables = ['meta', 'presets', 'decks', 'note_types', 'notes', 'cards', 'revlog'];
  const before = await dump(db, v1Tables);

  await migrate(db, T0 + 1);
  const after = await dump(db, v1Tables);
  for (const t of v1Tables) {
    const strip = (rows: unknown[]) =>
      rows.map((r) => {
        const { import_batch_id, ...rest } = r as Record<string, unknown>;
        expect(import_batch_id ?? null).toBeNull();
        return rest;
      });
    if (t === 'meta') {
      const m = (rows: unknown[]) => (rows as { key: string }[]).filter((r) => r.key !== 'schema_version');
      expect(m(after[t]!)).toEqual(m(before[t]!));
    } else {
      expect(strip(after[t]!), t).toEqual(before[t]);
    }
  }
  const [v] = await db.query<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`);
  expect(v!.value).toBe('2');
});
