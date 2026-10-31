import { beforeEach, expect, test } from 'vitest';
import { getDeckTreeWithCounts, planStudy, type DeckTreeWithCounts } from '../../src/services/deckService';
import { addNote, type NoteServiceDeps } from '../../src/services/noteService';
import { UndoStack } from '../../src/services/undo';
import { createDeck, setDeckPreset } from '../../src/data/decks';
import { createPreset } from '../../src/data/presets';
import { getBuiltinNoteType } from '../../src/data/noteTypes';
import { DEFAULT_PRESET } from '../../src/core/model';
import { studyDay } from '../../src/core/studyDay';
import { createMigratedDb } from '../helpers/testDb';
import { DAY, fixedClock, MIN, T0 } from '../helpers/fixtures';

let deps: NoteServiceDeps;
let basic: number;

beforeEach(async () => {
  const db = await createMigratedDb();
  deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  basic = (await getBuiltinNoteType(db, 'basic')).id;
});

async function addCards(deckId: number, n: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(...(await addNote(deps, { noteTypeId: basic, deckId, fields: [`Q${deckId}-${i}`, 'A'], tags: [] })).cardIds);
  return ids;
}

function find(tree: DeckTreeWithCounts[], id: number): DeckTreeWithCounts {
  for (const n of tree) {
    if (n.deck.id === id) return n;
    const c = n.children.length ? find(n.children, id) : undefined;
    if (c) return c;
  }
  return undefined as never;
}

async function setup() {
  const p = await createDeck(deps.db, { name: 'Biology' }, T0);
  const c1 = await createDeck(deps.db, { name: 'Cells', parentId: p }, T0);
  const c2 = await createDeck(deps.db, { name: 'Genetics', parentId: p }, T0);
  return { p, c1, c2 };
}

test('a parent limit of 20 caps two children with 15 new each', async () => {
  const { p, c1, c2 } = await setup();
  await addCards(c1, 15);
  await addCards(c2, 15);
  const tree = await getDeckTreeWithCounts(deps.db, T0);
  expect(find(tree, p).counts).toEqual({ new: 20, learn: 0, review: 0 });
  expect(find(tree, c1).counts.new).toBe(15);
  expect(find(tree, c2).counts.new).toBe(15);
  expect((await planStudy(deps.db, c1, T0)).newCards).toHaveLength(15);
});

test('a child limit of 5 inside the parent limit', async () => {
  const { p, c1, c2 } = await setup();
  await addCards(c1, 15);
  await addCards(c2, 15);
  const five = await createPreset(deps.db, 'Five', { ...DEFAULT_PRESET, newPerDay: 5 });
  await setDeckPreset(deps.db, c1, five);
  const tree = await getDeckTreeWithCounts(deps.db, T0);
  expect(find(tree, c1).counts.new).toBe(5);
  expect(find(tree, p).counts.new).toBe(20);
});

test('new cards studied today use up the limit and show as learning', async () => {
  const { c1 } = await setup();
  const five = await createPreset(deps.db, 'Five', { ...DEFAULT_PRESET, newPerDay: 5 });
  await setDeckPreset(deps.db, c1, five);
  const ids = await addCards(c1, 10);
  for (const [i, id] of ids.slice(0, 3).entries()) {
    await deps.db.execute(`UPDATE cards SET state = 1, due_at = ?, new_position = NULL WHERE id = ?`, [T0 + 10 * MIN, id]);
    await deps.db.execute(
      `INSERT INTO revlog (id, card_id, rating, state_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, kind) VALUES (?, ?, 3, 0, 1, 5, 0, 0, 3000, 0)`,
      [T0 - 60_000 + i, id],
    );
  }
  const counts = find(await getDeckTreeWithCounts(deps.db, T0), c1).counts;
  expect(counts).toEqual({ new: 2, learn: 3, review: 0 });
});

test('suspended and buried-today cards are not counted; buried yesterday counts again', async () => {
  const { c1 } = await setup();
  const ids = await addCards(c1, 3);
  const today = studyDay(T0, 4);
  await deps.db.execute(`UPDATE cards SET suspended = 1 WHERE id = ?`, [ids[0]]);
  await deps.db.execute(`UPDATE cards SET buried_day = ?, buried_kind = 'manual' WHERE id = ?`, [today, ids[1]]);
  expect(find(await getDeckTreeWithCounts(deps.db, T0), c1).counts.new).toBe(1);
  expect(find(await getDeckTreeWithCounts(deps.db, T0 + DAY), c1).counts.new).toBe(2);
});

test('reviews due before the next 4am count today', async () => {
  const { c1 } = await setup();
  const [id] = await addCards(c1, 1);
  // Due 02:00 tomorrow morning: still part of today's study day.
  await deps.db.execute(`UPDATE cards SET state = 2, due_at = ?, scheduled_days = 3, new_position = NULL WHERE id = ?`, [T0 + 17 * 60 * MIN, id]);
  expect(find(await getDeckTreeWithCounts(deps.db, T0), c1).counts.review).toBe(1);
});

test('an empty collection counts zero', async () => {
  const d = await createDeck(deps.db, { name: 'Empty' }, T0);
  const tree = await getDeckTreeWithCounts(deps.db, T0);
  expect(find(tree, d).counts).toEqual({ new: 0, learn: 0, review: 0 });
  const plan = await planStudy(deps.db, null, T0);
  expect(plan.newCards.length + plan.reviewCards.length + plan.learning.length).toBe(0);
});
