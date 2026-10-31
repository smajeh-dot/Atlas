import { beforeEach, expect, test } from 'vitest';
import type { Db } from '../../src/data/db';
import { DeckMoveError, DeckNameError, deckDeletionSummary, listDecks, placeDeck, setDeckColour } from '../../src/data/decks';
import { UndoStack } from '../../src/services/undo';
import { createMigratedDb } from '../helpers/testDb';
import { fixedClock, T0 } from '../helpers/fixtures';
import { seedDeck, seedNote } from '../helpers/seed';

let db: Db;
beforeEach(async () => {
  db = await createMigratedDb();
});

const top = async () => (await listDecks(db)).filter((d) => d.parentId === null).sort((a, b) => a.position - b.position);

test('placeDeck reorders siblings and renumbers positions', async () => {
  await seedDeck(db, 'A');
  await seedDeck(db, 'B');
  const c = await seedDeck(db, 'C');
  await placeDeck(db, c, null, 0);
  expect((await top()).map((d) => [d.name, d.position])).toEqual([['C', 0], ['A', 1], ['B', 2]]);
});

test('placeDeck clamps the index to the end', async () => {
  const a = await seedDeck(db, 'A');
  await seedDeck(db, 'B');
  await placeDeck(db, a, null, 99);
  expect((await top()).map((d) => d.name)).toEqual(['B', 'A']);
});

test('placeDeck nests, drops colour, and refuses cycles', async () => {
  const a = await seedDeck(db, 'A');
  const b = await seedDeck(db, 'B');
  await placeDeck(db, b, a, 0);
  const moved = (await listDecks(db)).find((d) => d.id === b)!;
  expect([moved.parentId, moved.colour]).toEqual([a, null]);
  await expect(placeDeck(db, a, b, 0)).rejects.toBeInstanceOf(DeckMoveError);
  await expect(placeDeck(db, a, a, 0)).rejects.toBeInstanceOf(DeckMoveError);
});

test('placeDeck gives a deck moved to the top level a colour', async () => {
  const a = await seedDeck(db, 'A');
  const sub = await seedDeck(db, 'Sub', a);
  await placeDeck(db, sub, null, 1);
  expect((await listDecks(db)).find((d) => d.id === sub)!.colour).toBe(2);
});

test('placeDeck refuses a sibling name clash', async () => {
  const a = await seedDeck(db, 'A');
  await seedDeck(db, 'Cells', a);
  const cells = await seedDeck(db, 'cells');
  await expect(placeDeck(db, cells, a, 0)).rejects.toBeInstanceOf(DeckNameError);
});

test('deckDeletionSummary counts subdecks and cards', async () => {
  const deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  const chem = await seedDeck(db, 'Chemistry');
  const org = await seedDeck(db, 'Organic', chem);
  await seedDeck(db, 'Inorganic', chem);
  await seedDeck(db, 'Mechanisms', org);
  await seedNote(deps, chem, 'basic_reversed', ['a', 'b']);
  await seedNote(deps, org, 'basic', ['c', 'd']);
  expect(await deckDeletionSummary(db, chem)).toEqual({ subdecks: 3, cards: 3 });
  expect(await deckDeletionSummary(db, org)).toEqual({ subdecks: 1, cards: 1 });
});

test('setDeckColour sets top-level colours and rejects subdecks', async () => {
  const a = await seedDeck(db, 'A');
  const sub = await seedDeck(db, 'Sub', a);
  await setDeckColour(db, a, 5);
  expect((await listDecks(db)).find((d) => d.id === a)!.colour).toBe(5);
  await expect(setDeckColour(db, sub, 2)).rejects.toBeInstanceOf(DeckMoveError);
  await expect(setDeckColour(db, a, 9)).rejects.toThrow();
});
