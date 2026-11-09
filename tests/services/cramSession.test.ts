import { beforeEach, expect, test } from 'vitest';
import { mulberry32 } from '../../src/core/random';
import { CramSession, type CramDeps } from '../../src/services/cramSession';
import { UndoStack } from '../../src/services/undo';
import { createMigratedDb } from '../helpers/testDb';
import { makeReview, seedDeck, seedNote } from '../helpers/seed';
import { DAY, fixedClock, T0 } from '../helpers/fixtures';

let deps: CramDeps & { undo: UndoStack };
let deck: number;

beforeEach(async () => {
  const db = await createMigratedDb();
  deps = { db, clock: fixedClock(T0), rng: mulberry32(1), undo: new UndoStack() };
  deck = await seedDeck(db, 'Chemistry');
});

async function addBasic(deckId: number, q: string, a = 'A'): Promise<number> {
  return (await seedNote(deps, deckId, 'basic', [q, a])).cardIds[0]!;
}

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

test('the pool includes subdecks, buried, new and not-due review cards, and excludes suspended ones', async () => {
  const sub = await seedDeck(deps.db, 'Organic', deck);
  const other = await seedDeck(deps.db, 'Physics');
  const a = await addBasic(deck, 'a');
  const inSub = await addBasic(sub, 'b');
  const buried = await addBasic(deck, 'c');
  const review = await addBasic(deck, 'd');
  const suspended = await addBasic(deck, 'e');
  await addBasic(other, 'elsewhere');
  await deps.db.execute(`UPDATE cards SET buried_day = 99999, buried_kind = 'manual' WHERE id = ?`, [buried]);
  await makeReview(deps.db, review, { dueAt: T0 + 30 * DAY });
  await deps.db.execute(`UPDATE cards SET suspended = 1 WHERE id = ?`, [suspended]);

  const s = await CramSession.open(deps, deck);
  expect(sorted(s.state().pool)).toEqual(sorted([a, inSub, buried, review]));
  expect(sorted(s.state().queue)).toEqual(sorted([a, inSub, buried, review]));
  expect(s.state().round).toBe(1);
});

test('all siblings of a reversed note are in the pool', async () => {
  const { cardIds } = await seedNote(deps, deck, 'basic_reversed', ['front', 'back']);
  expect(cardIds).toHaveLength(2);
  const s = await CramSession.open(deps, deck);
  expect(sorted(s.state().pool)).toEqual(sorted(cardIds));
});

test('current() is the front card, rendered for the deck', async () => {
  await addBasic(deck, 'Q', 'A');
  const s = await CramSession.open(deps, deck);
  const cur = s.current()!;
  expect(cur.card.id).toBe(s.state().queue[0]);
  expect(cur.question).toBe('Q');
  expect(cur.answer).toContain('A');
  expect(cur.note.id).toBe(cur.card.noteId);
  expect(cur.noteType.id).toBe(cur.note.noteTypeId);
});

test('answer(true) advances; answer(false) keeps the card and counts wrong', async () => {
  for (const q of ['a', 'b', 'c']) await addBasic(deck, q);
  const s = await CramSession.open(deps, deck);
  const [first, second] = s.state().queue;

  expect(await s.answer(true)).toEqual({ saved: true });
  expect(s.state().queue).toHaveLength(2);
  expect(s.state().right).toBe(1);
  expect(s.current()!.card.id).toBe(second);

  expect(await s.answer(false)).toEqual({ saved: true });
  expect(s.state().wrong).toBe(1);
  expect(s.state().queue).toHaveLength(2);
  expect(s.state().queue).toContain(second);
  expect(s.state().queue).not.toContain(first);
});

test('answer with the wrong expectedCardId is ignored', async () => {
  for (const q of ['a', 'b']) await addBasic(deck, q);
  const s = await CramSession.open(deps, deck);
  const before = structuredClone(s.state());
  const [front, other] = s.state().queue;
  expect(await s.answer(true, other)).toBeNull();
  expect(s.state()).toEqual(before);
  expect(await s.answer(true, front)).toEqual({ saved: true });
  expect(s.state().right).toBe(1);
});

test('two answers started without awaiting grade one card only', async () => {
  for (const q of ['a', 'b', 'c']) await addBasic(deck, q);
  const s = await CramSession.open(deps, deck);
  const first = s.answer(true);
  const second = s.answer(true);
  expect(await first).toEqual({ saved: true });
  expect(await second).toBeNull();
  expect(s.state().right).toBe(1);
  expect(s.state().queue).toHaveLength(2);
});

test('undo restores the exact previous state', async () => {
  for (const q of ['a', 'b', 'c', 'd']) await addBasic(deck, q);
  const s = await CramSession.open(deps, deck);
  expect(s.canUndo()).toBe(false);
  expect(await s.undo()).toBeNull();

  const start = structuredClone(s.state());
  await s.answer(false);
  const afterOne = structuredClone(s.state());
  await s.answer(true);
  expect(s.canUndo()).toBe(true);

  expect(await s.undo()).toEqual({ saved: true });
  expect(s.state()).toEqual(afterOne);
  expect(await s.undo()).toEqual({ saved: true });
  expect(s.state()).toEqual(start);
  expect(s.canUndo()).toBe(false);
  expect(s.current()!.card.id).toBe(start.queue[0]);
});

test('a finished round goes again with every eligible card, reshuffled', async () => {
  const ids = [await addBasic(deck, 'a'), await addBasic(deck, 'b'), await addBasic(deck, 'c')];
  await deps.db.execute(`UPDATE cards SET suspended = 1 WHERE id = ?`, [ids[2]]);
  const s = await CramSession.open(deps, deck);
  expect(s.state().pool).toHaveLength(2);
  while (!s.isComplete()) await s.answer(true);
  expect(s.current()).toBeNull();

  await deps.db.execute(`UPDATE cards SET suspended = 0 WHERE id = ?`, [ids[2]]);
  expect(await s.goAgain()).toEqual({ saved: true });
  expect(s.isComplete()).toBe(false);
  expect(s.state().round).toBe(2);
  expect(s.state().right).toBe(0);
  expect(s.state().wrong).toBe(0);
  expect(sorted(s.state().queue)).toEqual(sorted(ids));
  expect(sorted(s.state().pool)).toEqual(sorted(ids));
});

test('restart mid-round gives a fresh round 1 and clears undo', async () => {
  for (const q of ['a', 'b', 'c']) await addBasic(deck, q);
  const s = await CramSession.open(deps, deck);
  await s.goAgain();
  await s.answer(true);
  await s.answer(false);
  expect(s.state().round).toBe(2);

  expect(await s.restart()).toEqual({ saved: true });
  expect(s.state().round).toBe(1);
  expect(s.state().queue).toHaveLength(3);
  expect(s.state().right).toBe(0);
  expect(s.state().wrong).toBe(0);
  expect(s.canUndo()).toBe(false);
});

test('an empty deck is empty and shows no card', async () => {
  const s = await CramSession.open(deps, deck);
  expect(s.isEmpty()).toBe(true);
  expect(s.current()).toBeNull();
  expect(await s.answer(true)).toBeNull();
});

test('a deck with only suspended cards is empty', async () => {
  const id = await addBasic(deck, 'a');
  await deps.db.execute(`UPDATE cards SET suspended = 1 WHERE id = ?`, [id]);
  const s = await CramSession.open(deps, deck);
  expect(s.isEmpty()).toBe(true);
});

test('schedule safety: cards, notes and revlog are untouched by a whole session', async () => {
  for (const q of ['a', 'b', 'c', 'd']) await addBasic(deck, q);
  const rev = await addBasic(deck, 'e');
  await makeReview(deps.db, rev, { dueAt: T0 + 5 * DAY });
  const snap = async () => ({
    cards: await deps.db.query('SELECT * FROM cards ORDER BY id'),
    notes: await deps.db.query('SELECT * FROM notes ORDER BY id'),
    revlog: await deps.db.query('SELECT * FROM revlog ORDER BY id'),
  });
  const before = await snap();

  const s = await CramSession.open(deps, deck);
  let n = 0;
  while (!s.isComplete()) {
    await s.answer(n++ % 3 !== 0);
    if (n === 2) await s.undo();
  }
  await s.goAgain();
  await s.answer(false);
  await s.restart();

  expect(await snap()).toEqual(before);
});
