import { beforeEach, expect, test } from 'vitest';
import { getCard, setCardDeck } from '../../src/data/cards';
import { listTags } from '../../src/data/notes';
import { UndoStack } from '../../src/services/undo';
import { createMigratedDb } from '../helpers/testDb';
import { fixedClock, MIN, T0 } from '../helpers/fixtures';
import { seedDeck, seedNote } from '../helpers/seed';

let deps: { db: Awaited<ReturnType<typeof createMigratedDb>>; clock: ReturnType<typeof fixedClock>; undo: UndoStack };
beforeEach(async () => {
  deps = { db: await createMigratedDb(), clock: fixedClock(T0), undo: new UndoStack() };
});

test('setCardDeck moves one card only', async () => {
  const a = await seedDeck(deps.db, 'A');
  const b = await seedDeck(deps.db, 'B');
  const { cardIds } = await seedNote(deps, a, 'basic_reversed', ['x', 'y']);
  await setCardDeck(deps.db, cardIds[0]!, b, T0 + MIN);
  expect((await getCard(deps.db, cardIds[0]!)).deckId).toBe(b);
  expect((await getCard(deps.db, cardIds[0]!)).updatedAt).toBe(T0 + MIN);
  expect((await getCard(deps.db, cardIds[1]!)).deckId).toBe(a);
});

test('listTags is unique ignoring case and sorted', async () => {
  const a = await seedDeck(deps.db, 'A');
  await seedNote(deps, a, 'basic', ['1', 'x'], ['b', 'A']);
  await seedNote(deps, a, 'basic', ['2', 'x'], ['a', 'c']);
  expect(await listTags(deps.db)).toEqual(['A', 'b', 'c']);
});
