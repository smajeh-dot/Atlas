import { expect, test } from 'vitest';
import { createDeck, DeckMoveError, DeckNameError, deleteDeck, listDecks, moveDeck, renameDeck, setDeckCollapsed, setDeckPreset } from '../../src/data/decks';
import { createPreset } from '../../src/data/presets';
import { DEFAULT_PRESET } from '../../src/core/model';
import { createMigratedDb } from '../helpers/testDb';
import { T0 } from '../helpers/fixtures';

test('top-level decks get the next free colour; subdecks get none', async () => {
  const db = await createMigratedDb();
  const a = await createDeck(db, { name: 'Biology' }, T0);
  const b = await createDeck(db, { name: 'Chemistry' }, T0);
  const c = await createDeck(db, { name: '  Physics ' }, T0);
  const sub = await createDeck(db, { name: 'Cells', parentId: a }, T0);
  const all = await listDecks(db);
  const byId = (id: number) => all.find((x) => x.id === id)!;
  expect([byId(a).colour, byId(b).colour, byId(c).colour, byId(sub).colour]).toEqual([1, 2, 3, null]);
  expect(byId(c).name).toBe('Physics');
  expect(byId(sub).presetId).toBe(1);
});

test('a top-level deck can be given its colour; a bad colour is refused and a subdeck still gets none', async () => {
  const db = await createMigratedDb();
  const a = await createDeck(db, { name: 'Biology', colour: 3 }, T0);
  const next = await createDeck(db, { name: 'Chemistry' }, T0);
  const sub = await createDeck(db, { name: 'Cells', parentId: a, colour: 5 }, T0);
  await expect(createDeck(db, { name: 'Physics', colour: 9 }, T0)).rejects.toThrow(/not 1-8/);
  await expect(createDeck(db, { name: 'Maths', colour: 0 }, T0)).rejects.toThrow(/not 1-8/);
  const all = await listDecks(db);
  const byId = (id: number) => all.find((x) => x.id === id)!;
  // Biology took 3, so the next free colour for Chemistry is 1; the refused decks were not created.
  expect([byId(a).colour, byId(next).colour, byId(sub).colour]).toEqual([3, 1, null]);
  expect(all.map((d) => d.name).sort()).toEqual(['Biology', 'Cells', 'Chemistry']);
});

test('sibling names are unique ignoring case; cousins may share names', async () => {
  const db = await createMigratedDb();
  const a = await createDeck(db, { name: 'Biology' }, T0);
  await expect(createDeck(db, { name: 'biology' }, T0)).rejects.toBeInstanceOf(DeckNameError);
  const b = await createDeck(db, { name: 'Chemistry' }, T0);
  await createDeck(db, { name: 'Revision', parentId: a }, T0);
  await createDeck(db, { name: 'Revision', parentId: b }, T0);
  await expect(renameDeck(db, b, 'BIOLOGY')).rejects.toBeInstanceOf(DeckNameError);
});

test('empty names and names containing :: are rejected', async () => {
  const db = await createMigratedDb();
  await expect(createDeck(db, { name: '   ' }, T0)).rejects.toBeInstanceOf(DeckNameError);
  await expect(createDeck(db, { name: 'A::B' }, T0)).rejects.toBeInstanceOf(DeckNameError);
});

test('a deck cannot move into itself or its own subdeck', async () => {
  const db = await createMigratedDb();
  const a = await createDeck(db, { name: 'A' }, T0);
  const b = await createDeck(db, { name: 'B', parentId: a }, T0);
  await expect(moveDeck(db, a, b)).rejects.toBeInstanceOf(DeckMoveError);
  await expect(moveDeck(db, a, a)).rejects.toBeInstanceOf(DeckMoveError);
  const c = await createDeck(db, { name: 'C' }, T0);
  await moveDeck(db, c, a);
  expect((await listDecks(db)).find((x) => x.id === c)!.parentId).toBe(a);
});

test('preset and collapsed state are saved', async () => {
  const db = await createMigratedDb();
  const a = await createDeck(db, { name: 'A' }, T0);
  const p = await createPreset(db, 'Cram', DEFAULT_PRESET);
  await setDeckPreset(db, a, p);
  await setDeckCollapsed(db, a, true);
  const deck = (await listDecks(db))[0]!;
  expect(deck.presetId).toBe(p);
  expect(deck.collapsed).toBe(true);
});

test('deleting a deck keeps notes that still have cards elsewhere', async () => {
  const db = await createMigratedDb();
  const a = await createDeck(db, { name: 'A' }, T0);
  const aSub = await createDeck(db, { name: 'A sub', parentId: a }, T0);
  const b = await createDeck(db, { name: 'B' }, T0);
  const ins = (sql: string, p: unknown[]) => db.execute(sql, p);
  // Note 1: reversed, card 0 in A, card 1 in B. Note 2: one card in A sub.
  await ins(`INSERT INTO notes (id, guid, note_type_id, fields, sort_field, created_at, updated_at) VALUES (1, 'g1', 2, '["Q","A"]', 'Q', ?, ?)`, [T0, T0]);
  await ins(`INSERT INTO notes (id, guid, note_type_id, fields, sort_field, created_at, updated_at) VALUES (2, 'g2', 1, '["Q2","A2"]', 'Q2', ?, ?)`, [T0, T0]);
  await ins(`INSERT INTO cards (id, note_id, ord, deck_id, state, created_at, updated_at) VALUES (10, 1, 0, ?, 0, ?, ?)`, [a, T0, T0]);
  await ins(`INSERT INTO cards (id, note_id, ord, deck_id, state, created_at, updated_at) VALUES (11, 1, 1, ?, 0, ?, ?)`, [b, T0, T0]);
  await ins(`INSERT INTO cards (id, note_id, ord, deck_id, state, created_at, updated_at) VALUES (12, 2, 0, ?, 0, ?, ?)`, [aSub, T0, T0]);
  expect(await deleteDeck(db, a)).toEqual({ deletedCards: 2, deletedNotes: 1 });
  expect((await db.query<{ id: number }>('SELECT id FROM notes')).map((r) => r.id)).toEqual([1]);
  expect((await db.query<{ id: number }>('SELECT id FROM cards')).map((r) => r.id)).toEqual([11]);
  expect((await listDecks(db)).map((x) => x.name)).toEqual(['B']);
});
