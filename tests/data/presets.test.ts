import { expect, test } from 'vitest';
import { createPreset, deletePreset, getPreset, listPresets, PresetConfigError, PresetInUseError, updatePreset } from '../../src/data/presets';
import { getBuiltinNoteType, getNoteType, listNoteTypes } from '../../src/data/noteTypes';
import { DEFAULT_PRESET } from '../../src/core/model';
import { createMigratedDb } from '../helpers/testDb';
import { T0 } from '../helpers/fixtures';

test('create, read and update a preset', async () => {
  const db = await createMigratedDb();
  const id = await createPreset(db, 'Exam cram', { ...DEFAULT_PRESET, newPerDay: 40 });
  expect((await getPreset(db, id)).config.newPerDay).toBe(40);
  await updatePreset(db, id, { name: 'Cram', config: { desiredRetention: 0.95 } });
  const p = await getPreset(db, id);
  expect(p.name).toBe('Cram');
  expect(p.config.desiredRetention).toBe(0.95);
  expect(p.config.newPerDay).toBe(40);
  expect((await listPresets(db)).map((x) => x.name)).toEqual(['Default', 'Cram']);
});

test('a preset in use cannot be deleted', async () => {
  const db = await createMigratedDb();
  const id = await createPreset(db, 'Used', DEFAULT_PRESET);
  await db.execute(`INSERT INTO decks (name, preset_id, created_at) VALUES ('D', ?, ?)`, [id, T0]);
  await expect(deletePreset(db, id)).rejects.toBeInstanceOf(PresetInUseError);
});

test('the Default preset cannot be deleted; unused ones can', async () => {
  const db = await createMigratedDb();
  await expect(deletePreset(db, 1)).rejects.toThrow();
  const id = await createPreset(db, 'Spare', DEFAULT_PRESET);
  await deletePreset(db, id);
  expect(await listPresets(db)).toHaveLength(1);
});

test('stored preset configs gain new default keys', async () => {
  const db = await createMigratedDb();
  await db.execute(`UPDATE presets SET config = ? WHERE id = 1`, [JSON.stringify({ newPerDay: 5 })]);
  expect((await getPreset(db, 1)).config).toEqual({ ...DEFAULT_PRESET, newPerDay: 5 });
});

test('note types load with fields and templates', async () => {
  const db = await createMigratedDb();
  expect((await listNoteTypes(db)).map((t) => t.name)).toEqual(['Basic', 'Basic and reversed', 'Type the answer', 'Cloze']);
  const cloze = await getBuiltinNoteType(db, 'cloze');
  expect(cloze.kind).toBe('cloze');
  expect((await getNoteType(db, cloze.id)).fields.map((f) => f.name)).toEqual(['Text', 'Extra']);
});

test('invalid preset config is not saved', async () => {
  const db = await createMigratedDb();
  await expect(updatePreset(db, 1, { config: { learningSteps: ['x'] } })).rejects.toBeInstanceOf(PresetConfigError);
  await expect(createPreset(db, 'Bad', { ...DEFAULT_PRESET, newPerDay: -5 })).rejects.toBeInstanceOf(PresetConfigError);
  expect((await getPreset(db, 1)).config.learningSteps).toEqual(['1m', '10m']);
});
