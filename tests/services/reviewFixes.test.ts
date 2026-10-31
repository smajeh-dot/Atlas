import { beforeEach, expect, test } from 'vitest';
import { StudySession, type SessionDeps } from '../../src/services/studySession';
import { addNote } from '../../src/services/noteService';
import { UndoStack } from '../../src/services/undo';
import { getLimitNodes, planStudy } from '../../src/services/deckService';
import { createDeck, deleteDeck } from '../../src/data/decks';
import { getBuiltinNoteType } from '../../src/data/noteTypes';
import { nextRevlogId } from '../../src/data/revlog';
import { updatePreset } from '../../src/data/presets';
import { createMigratedDb } from '../helpers/testDb';
import { DAY, fixedClock, T0 } from '../helpers/fixtures';

let deps: SessionDeps & { clock: ReturnType<typeof fixedClock> };
let deck: number;
let basic: number;

beforeEach(async () => {
  const db = await createMigratedDb();
  deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  deck = await createDeck(db, { name: 'D' }, T0);
  basic = (await getBuiltinNoteType(db, 'basic')).id;
});

const add = async (q: string) => (await addNote(deps, { noteTypeId: basic, deckId: deck, fields: [q, 'a'], tags: [] })).cardIds[0]!;
const insertRevlog = (id: number, cardId: number, stateBefore: number) =>
  deps.db.execute(
    `INSERT INTO revlog (id, card_id, rating, state_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, kind) VALUES (?, ?, 3, ?, 1, 5, 0, 1, 1000, 1)`,
    [id, cardId, stateBefore],
  );

test('I-1: revlog ids only bump on a real collision, not past a future id', async () => {
  const c = await add('q');
  await insertRevlog(T0 + 365 * DAY, c, 0);
  expect(await nextRevlogId(deps.db, T0)).toBe(T0);
  await insertRevlog(T0, c, 2);
  expect(await nextRevlogId(deps.db, T0)).toBe(T0 + 1);
});

test('I-1: reviews dated in the future do not use up today\'s limits', async () => {
  const c = await add('q');
  await insertRevlog(T0 + 365 * DAY, c, 0);
  await insertRevlog(T0 + 365 * DAY + 1, c, 2);
  const [node] = await getLimitNodes(deps.db, T0, 4);
  expect(node!.newRemaining).toBe(20);
  expect(node!.reviewRemaining).toBe(200);
});

test('I-2: random order picks from all new cards, not just the next ones added', async () => {
  for (let i = 0; i < 50; i++) await add(`q${i}`);
  await updatePreset(deps.db, 1, { config: { newPerDay: 5, newCardOrder: 'random' } });
  const plan = await planStudy(deps.db, deck, T0);
  const positions = plan.newCards.map((c) => c.newPosition!);
  expect(positions).toHaveLength(5);
  expect(Math.max(...positions)).toBeGreaterThan(5);
  expect((await planStudy(deps.db, deck, T0)).newCards.map((c) => c.id)).toEqual(plan.newCards.map((c) => c.id));
});

test('I-3: deleting a deck with 33,000 notes works', async () => {
  await deps.db.execute(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 33000)
     INSERT INTO notes (id, guid, note_type_id, fields, sort_field, created_at, updated_at)
     SELECT i + 1000, 'bulk' || i, ?, '["q","a"]', 'q', 0, 0 FROM n`,
    [basic],
  );
  await deps.db.execute(
    `INSERT INTO cards (note_id, ord, deck_id, state, created_at, updated_at) SELECT id, 0, ?, 0, 0, 0 FROM notes WHERE guid LIKE 'bulk%'`,
    [deck],
  );
  expect(await deleteDeck(deps.db, deck)).toEqual({ deletedCards: 33000, deletedNotes: 33000 });
  expect(await deps.db.query('SELECT id FROM notes')).toHaveLength(0);
});

test('I-4: only answers on review cards use the review limit, and undo gives it back', async () => {
  const c = await add('q');
  await deps.db.execute(
    `UPDATE cards SET state = 2, due_at = ?, new_position = NULL, stability = 5, difficulty = 5, scheduled_days = 10, reps = 5, last_review_at = ? WHERE id = ?`,
    [T0 - DAY, T0 - 11 * DAY, c],
  );
  await insertRevlog(T0 - 11 * DAY, c, 0); // first studied long ago, so it is not a new card today
  const s = await StudySession.start(deps, deck);
  await s.answer(1, 1000); // review → relearning
  const after = async () => (await getLimitNodes(deps.db, deps.clock.now(), 4))[0]!;
  expect((await after()).reviewRemaining).toBe(199);
  expect((await after()).newRemaining).toBe(20);
  deps.clock.advance(10 * 60_000);
  await s.answer(3, 1000); // relearning answer does not count
  expect((await after()).reviewRemaining).toBe(199);
  await s.undo();
  await s.undo();
  expect((await after()).reviewRemaining).toBe(200);
});

test('M-4: an answer meant for another card is ignored', async () => {
  const a = await add('a');
  await add('b');
  const s = await StudySession.start(deps, deck);
  expect(await s.answer(3, 1000, a + 999)).toBeNull();
  expect(await deps.db.query('SELECT id FROM revlog')).toHaveLength(0);
  expect(await s.answer(3, 1000, a)).toEqual({ leech: false });
});

test('M-5: undo while an answer is saving does nothing', async () => {
  await add('a');
  await add('b');
  const s = await StudySession.start(deps, deck);
  const [, undone] = await Promise.all([s.answer(3, 1000), s.undo()]);
  expect(undone).toBeNull();
  expect(await deps.db.query('SELECT id FROM revlog')).toHaveLength(1);
});

test('M-6: undoing "add card" during a session drops the deleted card from the queue', async () => {
  await add('a');
  await add('b');
  const s = await StudySession.start(deps, deck);
  expect(await s.undo()).toBe('add card');
  expect(s.remaining().new).toBe(1);
  expect(await s.answer(3, 1000)).toEqual({ leech: false });
});
