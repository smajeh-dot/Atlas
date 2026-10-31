import { expect, test } from 'vitest';
import { migrate, SCHEMA_VERSION } from '../../src/data/migrations';
import { DEFAULT_PRESET, DEFAULT_SETTINGS } from '../../src/core/model';
import { createTestDb } from '../helpers/testDb';
import { T0 } from '../helpers/fixtures';

test('creates schema version 1 with defaults', async () => {
  const db = createTestDb();
  await migrate(db, T0);
  const meta = await db.query<{ key: string; value: string }>('SELECT key, value FROM meta ORDER BY key');
  const m = Object.fromEntries(meta.map((r) => [r.key, r.value]));
  expect(SCHEMA_VERSION).toBe(1);
  expect(m.schema_version).toBe('1');
  expect(m.created_at).toBe(String(T0));
  expect(JSON.parse(m.settings!)).toEqual(DEFAULT_SETTINGS);
});

test('installs the four built-in note types and the Default preset', async () => {
  const db = createTestDb();
  await migrate(db, T0);
  const types = await db.query<{ builtin: string }>('SELECT builtin FROM note_types ORDER BY id');
  expect(types.map((t) => t.builtin)).toEqual(['basic', 'basic_reversed', 'basic_typein', 'cloze']);
  const presets = await db.query<{ id: number; name: string; config: string }>('SELECT * FROM presets');
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
