import { expect, test } from 'vitest';
import { getSettings, SettingsError, updateSettings } from '../../src/data/settings';
import { DEFAULT_SETTINGS } from '../../src/core/model';
import { createMigratedDb } from '../helpers/testDb';

test('fresh database returns the defaults', async () => {
  expect(await getSettings(await createMigratedDb())).toEqual(DEFAULT_SETTINGS);
});

test('updates persist and merge', async () => {
  const db = await createMigratedDb();
  const s = await updateSettings(db, { dayStartHour: 5 });
  expect(s.dayStartHour).toBe(5);
  expect(s.theme).toBe('workbench');
  expect((await getSettings(db)).dayStartHour).toBe(5);
});

test('unknown stored keys are dropped and missing keys default', async () => {
  const db = await createMigratedDb();
  await db.execute(`UPDATE meta SET value = ? WHERE key = 'settings'`, [JSON.stringify({ theme: 'tangerine', bogus: 1 })]);
  const s = await getSettings(db);
  expect(s).toEqual({ ...DEFAULT_SETTINGS, theme: 'tangerine' });
});

test('invalid settings are not saved', async () => {
  const db = await createMigratedDb();
  await expect(updateSettings(db, { dayStartHour: 25 })).rejects.toBeInstanceOf(SettingsError);
  expect((await getSettings(db)).dayStartHour).toBe(4);
});
