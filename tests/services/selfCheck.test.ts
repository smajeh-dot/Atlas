import { expect, test } from 'vitest';
import { runSelfCheck } from '../../src/services/selfCheck';
import { SCHEMA_VERSION } from '../../src/data/migrations';
import { createMigratedDb, createTestDb } from '../helpers/testDb';
import { T0 } from '../helpers/fixtures';

test('a fresh database passes and nothing is written', async () => {
  const db = await createMigratedDb();
  const r = await runSelfCheck(db, T0);
  expect(r).toEqual({ ok: true, schemaVersion: SCHEMA_VERSION, integrity: 'ok', decks: 0, notes: 0, cards: 0, schedulerOk: true });
  expect(await db.query('SELECT id FROM revlog')).toHaveLength(0);
});

test('an unmigrated database fails the check', async () => {
  const r = await runSelfCheck(createTestDb(), T0);
  expect(r.ok).toBe(false);
  expect(r.schemaVersion).toBe(0);
});
