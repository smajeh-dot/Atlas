import { describe, expect, test } from 'vitest';
import { DEFAULT_PRESET } from '../../src/core/model';
import { listNoteTypes } from '../../src/data/noteTypes';
import { idsFrom, planDecks } from '../../src/import/decks';
import { planMedia } from '../../src/import/media';
import { planNoteTypes } from '../../src/import/noteTypes';
import { planChunk, RevlogIds, type ExistingNote, type PlanContext } from '../../src/import/plan';
import { ReportBuilder } from '../../src/import/report';
import { ankiToday } from '../../src/import/schedule';
import {
  homeDeckCounts, noteChunks, readDeckConfigs, readDecks, readMedia, readMeta, readNoteTypes, type Chunk, type StagingSource,
} from '../../src/import/staging';
import { createMigratedDb } from '../helpers/testDb';
import { expected, staged } from './helpers';

async function setup(src: StagingSource, opts: { existing?: Map<string, ExistingNote>; taken?: number[]; update?: boolean } = {}) {
  const db = await createMigratedDb();
  const meta = await readMeta(src);
  const exp = await expected('rich-modern');
  const now = exp.generated.now_ms;
  const report = new ReportBuilder();
  const decks = planDecks({
    decks: await readDecks(src), configs: await readDeckConfigs(src), homeDeckCounts: await homeDeckCounts(src),
    existingDecks: [], existingPresets: [{ id: 1, name: 'Default', config: DEFAULT_PRESET }], useDeckConfigs: true,
    deckIds: idsFrom(1), presetIds: idsFrom(2), now,
  }, report);
  const types = planNoteTypes(await readNoteTypes(src), await listNoteTypes(db), idsFrom(10), report);
  const media = planMedia(await readMedia(src), []);
  const ctx: PlanContext = {
    now, dayStartHour: 4,
    ankiToday: ankiToday({ crtSecs: meta.ankiCrt, rolloverHour: meta.ankiRolloverHour, creationOffsetMin: meta.ankiCreationOffset }, now),
    decks, types, stepsFor: () => ({ learn: 2, relearn: 1 }),
    existing: opts.existing ?? new Map(), noteIds: idsFrom(1000), cardIds: idsFrom(5000),
    revlogIds: new RevlogIds(new Set(opts.taken ?? [])), newPositionBase: 100, media, missingSeen: new Set(),
    updateExisting: opts.update ?? false,
  };
  const chunk: Chunk = { notes: [], cards: [], revlog: [] };
  for await (const c of noteChunks(src, 1000)) {
    chunk.notes.push(...c.notes);
    chunk.cards.push(...c.cards);
    chunk.revlog.push(...c.revlog);
  }
  return { ctx, report, chunk, exp };
}

describe('planChunk on the rich package', () => {
  test('every note, card and review arrives, with Anki ids kept where Atlas uses them', async () => {
    const { ctx, report, chunk, exp } = await setup(staged('rich-modern'));
    const plan = planChunk(chunk, ctx, report);
    expect(plan.notes).toHaveLength(exp.notes.length);
    expect(plan.cards).toHaveLength(exp.cards.length);
    expect(plan.revlog).toHaveLength(exp.revlog.length);
    expect(plan.revlog.map((r) => r.id).sort()).toEqual(exp.revlog.map((r) => r.id).sort());
    expect(new Set(plan.notes.map((n) => n.guid))).toEqual(new Set(exp.notes.map((n) => n.guid)));
    const methane = plan.notes.find((n) => n.fields[0] === 'Formula of methane')!;
    expect(methane.createdAt).toBe(exp.notes.find((n) => n.fields[0] === 'Formula of methane')!.id);
    expect(methane.sortField).toBe('Formula of methane');
    // Every card belongs to a planned note and a planned deck.
    const noteIds = new Set(plan.notes.map((n) => n.id));
    expect(plan.cards.every((c) => noteIds.has(c.noteId) && ctx.decks.deckFor.size > 0)).toBe(true);
    expect(report.skipped).toEqual({ existingNotes: 0, cardsWithNoContent: 0, reviewsForSkippedCards: 0 });
  });

  test('cloze cards keep Anki ords, including a note with only {{c3::}}', async () => {
    const { ctx, report, chunk } = await setup(staged('rich-modern'));
    const plan = planChunk(chunk, ctx, report);
    const propane = plan.notes.find((n) => n.fields[0]!.startsWith('Propane'))!;
    expect(plan.cards.filter((c) => c.noteId === propane.id).map((c) => c.ord)).toEqual([2]);
  });

  test('tags, flags and suspension come through; burying is dropped', async () => {
    const { ctx, report, chunk } = await setup(staged('rich-modern'));
    const plan = planChunk(chunk, ctx, report);
    const card = (front: string) => plan.cards.find((c) => c.noteId === plan.notes.find((n) => n.fields[0] === front)!.id)!;
    expect(plan.notes.find((n) => n.fields[0] === 'Säure')!.tags.sort()).toEqual(['Exam_2026', 'Säure', 'chem::acids_and_bases']);
    expect(card('State card 03').suspended).toBe(true);
    expect(card('State card 04').flag).toBe(1);
    expect(card('State card 06').flag).toBe(7);
    expect(card('State card 06').buriedDay).toBeNull();
    expect(card('State card 10').buriedDay).toBeNull();
    expect(card('State card 11').suspended).toBe(true);
  });

  test('new cards queue after Atlas\'s own, in Anki order', async () => {
    const { ctx, report, chunk } = await setup(staged('rich-modern'));
    const plan = planChunk(chunk, ctx, report);
    const news = plan.cards.filter((c) => c.state === 0);
    expect(news.every((c) => c.newPosition! > 100)).toBe(true);
  });

  test('the report names what Atlas cannot show yet', async () => {
    const { ctx, report, chunk } = await setup(staged('rich-modern'));
    planChunk(chunk, ctx, report);
    const w = new Map(report.build('modern', 0).warnings.map((x) => [x.code, x]));
    expect(w.get('sound')!.count).toBe(1);
    expect(w.get('latex')!.count).toBe(1);
    expect(w.get('active-content')!.count).toBe(1);
    expect(w.get('image-occlusion')!.count).toBe(1);
    expect(w.get('missing-media')!.examples.sort()).toEqual(['missing-diagram.png', 'x.png']);
    expect(w.has('renamed-tags')).toBe(false);
  });
});

describe('planChunk with notes Atlas already has', () => {
  test('an existing note is untouched, but cards it lacks are added to it', async () => {
    const src = staged('rich-modern');
    const exp = await expected('rich-modern');
    const na = exp.notes.find((n) => n.fields[0] === 'Na')!;
    const existing = new Map([[na.guid, { id: 77, noteTypeId: 2, fields: ['Na', 'old'], tags: [], ords: new Set([0]) }]]);
    const { ctx, report, chunk } = await setup(src, { existing });
    const plan = planChunk(chunk, ctx, report);
    expect(plan.notes.some((n) => n.guid === na.guid)).toBe(false);
    expect(plan.noteUpdates).toEqual([]);
    expect(plan.cards.filter((c) => c.noteId === 77).map((c) => c.ord)).toEqual([1]);
    expect(report.skipped.existingNotes).toBe(1);
  });

  test('with "update notes", text and tags are refreshed but scheduling is not', async () => {
    const src = staged('rich-modern');
    const exp = await expected('rich-modern');
    const na = exp.notes.find((n) => n.fields[0] === 'Na')!;
    const existing = new Map([[na.guid, { id: 77, noteTypeId: 2, fields: ['Na', 'old'], tags: [], ords: new Set([0, 1]) }]]);
    const { ctx, report, chunk } = await setup(src, { existing, update: true });
    const plan = planChunk(chunk, ctx, report);
    expect(plan.noteUpdates.map((n) => [n.id, n.fields])).toEqual([[77, ['Na', 'Sodium']]]);
    expect(plan.cards.some((c) => c.noteId === 77)).toBe(false);
    expect(report.updatedNotes).toBe(1);
  });

  test('a review id Atlas already uses moves on by 1 ms', async () => {
    const exp = await expected('rich-modern');
    const first = Math.min(...exp.revlog.map((r) => r.id));
    const { ctx, report, chunk } = await setup(staged('rich-modern'), { taken: [first] });
    const plan = planChunk(chunk, ctx, report);
    const ids = plan.revlog.map((r) => r.id);
    expect(ids).not.toContain(first);
    expect(ids).toContain(first + 1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('planChunk on damaged input', () => {
  test('a card with no template is skipped with its reviews; a note left with no cards is skipped', async () => {
    const { ctx, report, chunk } = await setup(staged('rich-modern'));
    const gold = chunk.notes.find((n) => n.fields[0] === 'Symbol for gold')!;
    const card = chunk.cards.find((c) => c.noteId === gold.id)!;
    const broken: Chunk = {
      notes: [gold],
      cards: [{ ...card, ord: 5 }],
      revlog: [{ id: 1, cardId: card.id, ease: 3, ivl: 1, lastIvl: 0, factor: 2500, timeMs: 1, type: 0 }],
    };
    const plan = planChunk(broken, ctx, report);
    expect(plan.notes).toEqual([]);
    expect(report.skipped).toMatchObject({ cardsWithNoContent: 1, reviewsForSkippedCards: 1 });
  });

  test('a note with too many fields keeps the extra text on its last field', async () => {
    const { ctx, report, chunk } = await setup(staged('rich-modern'));
    const gold = chunk.notes.find((n) => n.fields[0] === 'Symbol for gold')!;
    const plan = planChunk({ ...chunk, notes: [{ ...gold, fields: ['Symbol for gold', 'Au', 'aurum'] }] }, ctx, report);
    expect(plan.notes[0]!.fields).toEqual(['Symbol for gold', 'Au<br>aurum']);
    expect(report.has('field-count')).toBe(true);
  });

  test('the same inputs always give the same plan', async () => {
    const a = await setup(staged('rich-modern'));
    const b = await setup(staged('rich-modern'));
    expect(planChunk(a.chunk, a.ctx, a.report)).toEqual(planChunk(b.chunk, b.ctx, b.report));
  });
});
