import { describe, expect, test } from 'vitest';
import { DEFAULT_PRESET, type Deck, type Preset } from '../../src/core/model';
import { idsFrom, planDecks, presetConfigFrom, stepString, type DeckPlanInput } from '../../src/import/decks';
import { ReportBuilder } from '../../src/import/report';
import { homeDeckCounts, readDeckConfigs, readDecks, type SDeck } from '../../src/import/staging';
import { T0 } from '../helpers/fixtures';
import { staged } from './helpers';

const DEFAULT: Preset = { id: 1, name: 'Default', config: DEFAULT_PRESET };

async function richInput(existingDecks: Deck[] = [], existingPresets: Preset[] = [DEFAULT]): Promise<DeckPlanInput> {
  const src = staged('rich-modern');
  return {
    decks: await readDecks(src),
    configs: await readDeckConfigs(src),
    homeDeckCounts: await homeDeckCounts(src),
    existingDecks,
    existingPresets,
    useDeckConfigs: true,
    deckIds: idsFrom(100),
    presetIds: idsFrom(10),
    now: T0,
  };
}

const deck = (id: number, name: string, parentId: number | null, presetId = 1): Deck => ({
  id, name, parentId, presetId, colour: parentId === null ? 1 : null, position: 0, collapsed: false, kind: 'normal', createdAt: 0,
});

describe('planDecks on a real package', () => {
  test('Anki paths become a tree; empty Default and filtered decks are not created', async () => {
    const report = new ReportBuilder();
    const plan = planDecks(await richInput(), report);
    const paths = [...plan.create].map((d) => plan.pathOf.get(d.id) ?? d.name).sort();
    expect(paths).toEqual([
      // Anki doesn't export decks with no cards, so Chem::Empty never reaches the package.
      'Chem', 'Chem::Inorganic', 'Chem::Interday', 'Chem::Organic', 'Chem::Organic::Alkanes', 'Chem::States',
    ]);
    expect(plan.create.find((d) => d.name === 'Chem')!.parentId).toBeNull();
    const organic = plan.create.find((d) => d.name === 'Organic')!;
    expect(plan.create.find((d) => d.name === 'Alkanes')!.parentId).toBe(organic.id);
    expect(plan.create.some((d) => d.name === 'Default' || d.name === 'Cram')).toBe(false);
    expect(report.build('modern', 0).warnings.map((w) => [w.code, w.count])).toEqual([['filtered-deck', 1]]);
  });

  test('each Anki options group becomes a preset; Anki defaults use Atlas Default', async () => {
    const plan = planDecks(await richInput(), new ReportBuilder());
    const byName = new Map(plan.create.map((d) => [d.name, d]));
    expect(byName.get('States')!.presetId).toBe(1);
    expect(plan.presets.map((p) => p.name).sort()).toEqual(['Exam cram', 'Interday steps']);
    const exam = plan.presets.find((p) => p.name === 'Exam cram')!;
    expect(byName.get('Inorganic')!.presetId).toBe(exam.id);
    expect(exam.config).toMatchObject({ newPerDay: 50, reviewsPerDay: 500, desiredRetention: 0.85, learningSteps: ['1m', '10m'] });
    const interday = plan.presets.find((p) => p.name === 'Interday steps')!;
    expect(interday.config).toMatchObject({ learningSteps: ['10m', '1d'], relearningSteps: ['10m', '2d'] });
  });

  test('existing decks are reused ignoring case and keep their own preset', async () => {
    const existing = [deck(1, 'chem', null, 7), deck(2, 'organic', 1, 7)];
    const plan = planDecks(await richInput(existing), new ReportBuilder());
    expect(plan.create.some((d) => d.name.toLowerCase() === 'chem' || d.name.toLowerCase() === 'organic')).toBe(false);
    expect(plan.create.find((d) => d.name === 'Alkanes')!.parentId).toBe(2);
  });

  test('planning again over the result creates nothing', async () => {
    const first = planDecks(await richInput(), new ReportBuilder());
    const decks: Deck[] = first.create.map((d) => ({ ...d, collapsed: false, kind: 'normal' as const }));
    const second = planDecks(await richInput(decks, [DEFAULT, ...first.presets]), new ReportBuilder());
    expect(second.create).toEqual([]);
    expect(second.presets).toEqual([]);
  });
});

describe('planDecks on awkward input', () => {
  const base = (decks: SDeck[], counts: [number, number][]): DeckPlanInput => ({
    decks, configs: [], homeDeckCounts: new Map(counts), existingDecks: [], existingPresets: [DEFAULT],
    useDeckConfigs: true, deckIds: idsFrom(1), presetIds: idsFrom(2), now: T0,
  });
  const d = (id: number, namePath: string): SDeck => ({ id, namePath, isFiltered: false, configId: 1 });

  test('a blank level is named rather than refused', () => {
    const report = new ReportBuilder();
    const plan = planDecks(base([d(5, 'Chem:: ::Acids')], [[5, 1]]), report);
    expect(plan.pathOf.get(plan.deckFor.get(5)!)).toBe('Chem::Untitled deck::Acids');
    expect(report.has('renamed-deck')).toBe(true);
  });

  test('cards whose deck is missing from the file go to an "Imported" deck', () => {
    const plan = planDecks(base([], [[99, 3]]), new ReportBuilder());
    expect(plan.pathOf.get(plan.deckFor.get(99)!)).toBe('Imported');
  });

  test("Anki's Default deck is kept when it has cards", () => {
    const plan = planDecks(base([d(1, 'Default')], [[1, 2]]), new ReportBuilder());
    expect(plan.create.map((x) => x.name)).toEqual(['Default']);
  });

  test('new top-level decks get distinct colours', () => {
    const plan = planDecks(base([d(2, 'A'), d(3, 'B'), d(4, 'B::C')], [[2, 1], [3, 1], [4, 1]]), new ReportBuilder());
    expect(plan.create.map((x) => x.colour)).toEqual([1, 2, null]);
  });
});

test('steps in minutes become preset step strings', () => {
  expect([1, 10, 59, 60, 1440, 2880, 2000, 0.4].map(stepString)).toEqual(['1m', '10m', '59m', '60m', '1d', '2d', '2000m', '1m']);
});

test('desired retention is kept in the range FSRS handles', () => {
  const c = { id: 1, name: 'x', newPerDay: 20, reviewsPerDay: 200, learnStepsMin: [], relearnStepsMin: [], desiredRetention: 0.5 };
  expect(presetConfigFrom(c).desiredRetention).toBe(0.7);
  expect(presetConfigFrom({ ...c, desiredRetention: null }).desiredRetention).toBe(0.9);
});
