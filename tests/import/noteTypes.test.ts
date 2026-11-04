import { expect, test } from 'vitest';
import { listNoteTypes } from '../../src/data/noteTypes';
import { idsFrom } from '../../src/import/decks';
import { planNoteTypes, unknownFilters } from '../../src/import/noteTypes';
import { ReportBuilder } from '../../src/import/report';
import { readNoteTypes } from '../../src/import/staging';
import { createMigratedDb } from '../helpers/testDb';
import { staged } from './helpers';

async function planRich(existing?: Awaited<ReturnType<typeof listNoteTypes>>) {
  const db = await createMigratedDb();
  const types = await readNoteTypes(staged('rich-modern'));
  const report = new ReportBuilder();
  const plan = planNoteTypes(types, existing ?? (await listNoteTypes(db)), idsFrom(100), report);
  const byAnkiName = new Map(types.map((t) => [t.name, plan.typeFor.get(t.id)!]));
  return { plan, report, byAnkiName, types };
}

test("Anki's stock Basic types reuse Atlas's built-ins despite different line breaks and CSS", async () => {
  const { byAnkiName } = await planRich();
  expect(byAnkiName.get('Basic')!.builtin).toBe('basic');
  expect(byAnkiName.get('Basic (and reversed card)')!.builtin).toBe('basic_reversed');
  expect(byAnkiName.get('Basic (type in the answer)')!.builtin).toBe('basic_typein');
});

test('types with no Atlas equivalent are created; a taken name gets "(imported)"', async () => {
  const { plan, report, byAnkiName } = await planRich();
  // Atlas's Cloze has an "Extra" field where Anki's has "Back Extra", so it's a different type with the same name.
  expect(byAnkiName.get('Cloze')!.name).toBe('Cloze (imported)');
  expect(byAnkiName.get('Cloze')!.kind).toBe('cloze');
  expect(byAnkiName.get('Chem Reaction')!.fields.map((f) => f.name)).toEqual(['Reactants', 'Products', 'Conditions']);
  expect(plan.create.map((t) => t.name).sort()).toEqual([
    'Basic (optional reversed card)', 'Chem Reaction', 'Cloze (imported)', 'Image Occlusion',
  ]);
  expect(new Set(plan.create.map((t) => t.id)).size).toBe(4);
  const warnings = report.build('modern', 0).warnings;
  expect(warnings.find((w) => w.code === 'renamed-note-type')!.examples).toEqual(['Cloze → Cloze (imported)']);
  expect(warnings.find((w) => w.code === 'unknown-filter')!.examples).toEqual(['Chem Reaction: {{furigana:…}}']);
});

test('Image Occlusion stays a cloze type so every card keeps its history', async () => {
  const { plan, byAnkiName, types } = await planRich();
  const io = types.find((t) => t.name === 'Image Occlusion')!;
  expect(plan.imageOcclusion.has(io.id)).toBe(true);
  expect(byAnkiName.get('Image Occlusion')!.kind).toBe('cloze');
});

test('importing the same types again reuses what the first import created', async () => {
  const db = await createMigratedDb();
  const first = await planRich();
  const second = await planRich([...(await listNoteTypes(db)), ...first.plan.create]);
  expect(second.plan.create).toEqual([]);
  for (const t of first.types) expect(second.plan.typeFor.get(t.id)!.id).toBe(first.plan.typeFor.get(t.id)!.id);
});

test('unknown filters are found on either side of either template', () => {
  const t = {
    name: 'X', kind: 'standard' as const, builtin: null, css: '', fields: [{ name: 'A' }],
    templates: [{ name: 'c', front: '{{A}}{{tts en_GB:A}}', back: '{{kana:A}}{{text:A}}' }],
  };
  expect(unknownFilters(t).sort()).toEqual(['kana', 'tts en_GB']);
});
