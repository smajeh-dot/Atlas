import { beforeEach, expect, test } from 'vitest';
import { getCardInfo } from '../../src/services/cardInfo';
import { getDeckSummary } from '../../src/services/deckService';
import { findDuplicateDeck, updateNote } from '../../src/services/noteService';
import { getCard } from '../../src/data/cards';
import { getNote } from '../../src/data/notes';
import { StudySession } from '../../src/services/studySession';
import { UndoStack, undoIfLatest, undoLast } from '../../src/services/undo';
import { createMigratedDb } from '../helpers/testDb';
import { DAY, fixedClock, MIN, T0 } from '../helpers/fixtures';
import { countRows, makeReview, seedDeck, seedNote } from '../helpers/seed';

let deps: { db: Awaited<ReturnType<typeof createMigratedDb>>; clock: ReturnType<typeof fixedClock>; undo: UndoStack };
beforeEach(async () => {
  deps = { db: await createMigratedDb(), clock: fixedClock(T0), undo: new UndoStack() };
});

test('getDeckSummary buckets cards and includes subdecks', async () => {
  const bio = await seedDeck(deps.db, 'Biology');
  const cells = await seedDeck(deps.db, 'Cells', bio);
  await seedNote(deps, bio, 'basic', ['new', 'x']);
  const learning = (await seedNote(deps, cells, 'basic', ['learning', 'x'])).cardIds[0]!;
  const young = (await seedNote(deps, cells, 'basic', ['young', 'x'])).cardIds[0]!;
  const mature = (await seedNote(deps, bio, 'basic', ['mature', 'x'])).cardIds[0]!;
  const susp = (await seedNote(deps, bio, 'basic', ['suspended', 'x'])).cardIds[0]!;
  await deps.db.execute(`UPDATE cards SET state = 1, due_at = ?, new_position = NULL WHERE id = ?`, [T0, learning]);
  await makeReview(deps.db, young, { dueAt: T0 + DAY, scheduledDays: 5 });
  await makeReview(deps.db, mature, { dueAt: T0 + DAY, scheduledDays: 30 });
  await makeReview(deps.db, susp, { dueAt: T0 + DAY, scheduledDays: 30 });
  await deps.db.execute(`UPDATE cards SET suspended = 1 WHERE id = ?`, [susp]);
  expect(await getDeckSummary(deps.db, bio)).toEqual({ total: 5, new: 1, learning: 1, young: 1, mature: 1, suspended: 1 });
  expect(await getDeckSummary(deps.db, cells)).toEqual({ total: 2, new: 0, learning: 1, young: 1, mature: 0, suspended: 0 });
});

test('getCardInfo after two answers', async () => {
  const deck = await seedDeck(deps.db, 'Chemistry');
  const { cardIds } = await seedNote(deps, deck, 'basic', ['q', 'a']);
  const s = await StudySession.start(deps, deck);
  await s.answer(3, 4000, cardIds[0]);
  deps.clock.advance(10 * MIN);
  await s.answer(3, 6000, cardIds[0]);
  const info = await getCardInfo(deps.db, cardIds[0]!);
  expect(info).toMatchObject({
    cardId: cardIds[0], added: T0, firstReview: T0, latestReview: T0 + 10 * MIN, reviews: 2, lapses: 0,
    averageMs: 5000, deckName: 'Chemistry', noteTypeName: 'Basic', cardName: 'Card 1',
  });
  expect(info.due).toBeGreaterThan(T0 + 10 * MIN);
  expect(info.intervalDays).toBeGreaterThan(0);
});

test('getCardInfo of a new cloze card', async () => {
  const deck = await seedDeck(deps.db, 'Biology');
  const { cardIds } = await seedNote(deps, deck, 'cloze', ['{{c1::a}} {{c2::b}}', '']);
  const info = await getCardInfo(deps.db, cardIds[1]!);
  expect(info).toMatchObject({ cardName: 'Cloze 2', reviews: 0, firstReview: null, latestReview: null, averageMs: null, due: null });
});

test('undoLast runs the top entry and returns its label', async () => {
  const deck = await seedDeck(deps.db, 'A');
  await seedNote(deps, deck, 'basic', ['q', 'a']);
  expect(deps.undo.peek()?.label).toBe('add card');
  expect(await undoLast(deps.db, deps.undo)).toBe('add card');
  expect(await countRows(deps.db, 'notes')).toBe(0);
  expect(await undoLast(deps.db, deps.undo)).toBeNull();
});

test('findDuplicateDeck returns the deck of the duplicate', async () => {
  const bio = await seedDeck(deps.db, 'Biology');
  const { noteId } = await seedNote(deps, bio, 'basic', ['Osmosis', 'x']);
  const basicId = (await deps.db.query<{ id: number }>(`SELECT id FROM note_types WHERE builtin = 'basic'`))[0]!.id;
  expect(await findDuplicateDeck(deps.db, basicId, 'osmosis')).toBe(bio);
  expect(await findDuplicateDeck(deps.db, basicId, 'unique')).toBeNull();
  expect(await findDuplicateDeck(deps.db, basicId, 'Osmosis', noteId)).toBeNull();
});

test('undoIfLatest undoes an entry only while it is still the most recent action', async () => {
  const deck = await seedDeck(deps.db, 'A');
  const first = await seedNote(deps, deck, 'basic', ['one', 'x']);
  await seedNote(deps, deck, 'basic', ['two', 'x']);
  expect(await undoIfLatest(deps.db, deps.undo, first.undoEntry)).toBeNull();
  expect(await countRows(deps.db, 'notes')).toBe(2);
  await undoLast(deps.db, deps.undo);
  expect(await undoIfLatest(deps.db, deps.undo, first.undoEntry)).toBe('add card');
  expect(await countRows(deps.db, 'notes')).toBe(0);
});

test('updateNote can move a card in the same transaction, and a failure saves neither change', async () => {
  const a = await seedDeck(deps.db, 'A');
  const b = await seedDeck(deps.db, 'B');
  const { noteId, cardIds } = await seedNote(deps, a, 'basic', ['old', 'x']);
  await updateNote(deps, noteId, { fields: ['new', 'x'], tags: [] }, { moveCard: { cardId: cardIds[0]!, deckId: b } });
  expect((await getNote(deps.db, noteId)).fields[0]).toBe('new');
  expect((await getCard(deps.db, cardIds[0]!)).deckId).toBe(b);
  await expect(updateNote(deps, noteId, { fields: ['newer', 'x'], tags: [] }, { moveCard: { cardId: cardIds[0]!, deckId: 9999 } })).rejects.toThrow();
  expect((await getNote(deps.db, noteId)).fields[0]).toBe('new');
});
