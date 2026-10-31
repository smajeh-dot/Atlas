import { beforeEach, expect, test } from 'vitest';
import { StudySession, type SessionDeps } from '../../src/services/studySession';
import { addNote } from '../../src/services/noteService';
import { UndoStack } from '../../src/services/undo';
import { planStudy } from '../../src/services/deckService';
import { createDeck } from '../../src/data/decks';
import { getBuiltinNoteType } from '../../src/data/noteTypes';
import { getCard } from '../../src/data/cards';
import { getNote } from '../../src/data/notes';
import { updatePreset } from '../../src/data/presets';
import { updateSettings } from '../../src/data/settings';
import { studyDay } from '../../src/core/studyDay';
import { createMigratedDb } from '../helpers/testDb';
import { DAY, fixedClock, MIN, T0 } from '../helpers/fixtures';

let deps: SessionDeps & { clock: ReturnType<typeof fixedClock> };
let deck: number;

beforeEach(async () => {
  const db = await createMigratedDb();
  deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  deck = await createDeck(db, { name: 'Chemistry' }, T0);
});

async function add(type: 'basic' | 'basic_reversed', fields: string[]) {
  const t = await getBuiltinNoteType(deps.db, type);
  return addNote(deps, { noteTypeId: t.id, deckId: deck, fields, tags: [] });
}

async function makeReview(cardId: number, lapses = 0) {
  await deps.db.execute(
    `UPDATE cards SET state = 2, due_at = ?, new_position = NULL, stability = 5, difficulty = 5, scheduled_days = 10,
     reps = 10, lapses = ?, last_review_at = ? WHERE id = ?`,
    [T0 - DAY, lapses, T0 - 11 * DAY, cardId],
  );
}

test('three new cards; Good sends the first to the 10 minute step', async () => {
  const ids = [];
  for (const q of ['a', 'b', 'c']) ids.push((await add('basic', [q, 'x'])).cardIds[0]!);
  const s = await StudySession.start(deps, deck);
  expect(s.remaining()).toEqual({ new: 3, learn: 0, review: 0 });
  expect(s.current()!.card.id).toBe(ids[0]);
  expect(s.current()!.question).toBe('a');
  expect(await s.answer(3, 4000)).toEqual({ leech: false });
  expect(s.remaining()).toEqual({ new: 2, learn: 1, review: 0 });
  expect(s.current()!.card.id).toBe(ids[1]);
  deps.clock.advance(10 * MIN);
  expect(s.current()!.card.id).toBe(ids[0]);
});

test('the interval on a button is what answering gives', async () => {
  const { cardIds } = await add('basic', ['q', 'a']);
  const s = await StudySession.start(deps, deck);
  const preview = s.current()!.previews[3];
  await s.answer(3, 1000);
  expect((await getCard(deps.db, cardIds[0]!)).dueAt! - T0).toBe(preview);
  const r = await deps.db.query<{ duration_ms: number; rating: number }>('SELECT duration_ms, rating FROM revlog');
  expect(r).toEqual([{ duration_ms: 1000, rating: 3 }]);
});

test('answer time is capped at the preset maximum', async () => {
  await add('basic', ['q', 'a']);
  const s = await StudySession.start(deps, deck);
  await s.answer(3, 5 * MIN);
  const [r] = await deps.db.query<{ duration_ms: number }>('SELECT duration_ms FROM revlog');
  expect(r!.duration_ms).toBe(60_000);
});

test('answering a reversed card buries its sibling until tomorrow', async () => {
  const { cardIds } = await add('basic_reversed', ['dog', 'chien']);
  const s = await StudySession.start(deps, deck);
  expect(s.current()!.card.id).toBe(cardIds[0]);
  await s.answer(3, 1000);
  const sibling = await getCard(deps.db, cardIds[1]!);
  expect(sibling.buriedDay).toBe(studyDay(T0, 4));
  expect(sibling.buriedKind).toBe('sibling');
  const tomorrow = await planStudy(deps.db, deck, T0 + DAY);
  expect(tomorrow.newCards.map((c) => c.id)).toContain(cardIds[1]);
});

test('the 8th lapse makes a leech: tagged and suspended', async () => {
  const { noteId, cardIds } = await add('basic', ['q', 'a']);
  await makeReview(cardIds[0]!, 7);
  const s = await StudySession.start(deps, deck);
  expect(s.remaining().review).toBe(1);
  expect(await s.answer(1, 1000)).toEqual({ leech: true });
  expect((await getNote(deps.db, noteId)).tags).toContain('leech');
  expect((await getCard(deps.db, cardIds[0]!)).suspended).toBe(true);
  expect(s.current()).toBeNull();
});

test('with "tag only" a leech stays active', async () => {
  await updatePreset(deps.db, 1, { config: { leechAction: 'tag' } });
  const { cardIds } = await add('basic', ['q', 'a']);
  await makeReview(cardIds[0]!, 7);
  const s = await StudySession.start(deps, deck);
  expect(await s.answer(1, 1000)).toEqual({ leech: true });
  expect((await getCard(deps.db, cardIds[0]!)).suspended).toBe(false);
});

test('a lapse below the threshold is not a leech', async () => {
  const { cardIds } = await add('basic', ['q', 'a']);
  await makeReview(cardIds[0]!, 2);
  const s = await StudySession.start(deps, deck);
  expect(await s.answer(1, 1000)).toEqual({ leech: false });
});

test('pressing a grade twice at once grades the card once', async () => {
  await add('basic', ['q', 'a']);
  await add('basic', ['q2', 'a']);
  const s = await StudySession.start(deps, deck);
  const results = await Promise.all([s.answer(3, 1000), s.answer(3, 1000)]);
  expect(results.filter((r) => r === null)).toHaveLength(1);
  expect(await deps.db.query('SELECT id FROM revlog')).toHaveLength(1);
});

test('undo restores the card, removes the review and shows the card again', async () => {
  const { cardIds } = await add('basic_reversed', ['dog', 'chien']);
  const before = await getCard(deps.db, cardIds[0]!);
  const siblingBefore = await getCard(deps.db, cardIds[1]!);
  const s = await StudySession.start(deps, deck);
  await s.answer(3, 1000);
  expect(await s.undo()).toBe('answer Good');
  expect(await getCard(deps.db, cardIds[0]!)).toEqual(before);
  expect(await getCard(deps.db, cardIds[1]!)).toEqual(siblingBefore);
  expect(await deps.db.query('SELECT id FROM revlog')).toHaveLength(0);
  expect(s.current()!.card.id).toBe(cardIds[0]);
  expect(s.remaining()).toEqual({ new: 1, learn: 0, review: 0 });
  expect(await s.undo()).toBe('add card');
  expect(await s.undo()).toBeNull();
});

test('studying an empty deck is complete straight away', async () => {
  const s = await StudySession.start(deps, deck);
  expect(s.current()).toBeNull();
  expect(s.isComplete()).toBe(true);
  expect(await s.answer(3, 1000)).toBeNull();
});

test('when nothing else is left, a card due within the learn-ahead limit is shown early', async () => {
  const { cardIds } = await add('basic', ['q', 'a']);
  const s = await StudySession.start(deps, deck);
  await s.answer(3, 1000); // due in 10 minutes
  expect(s.current()!.card.id).toBe(cardIds[0]);
  expect(s.isComplete()).toBe(false);
});

test('outside the learn-ahead limit the session waits for the card', async () => {
  await updateSettings(deps.db, { learnAheadMinutes: 5 });
  await add('basic', ['q', 'a']);
  const s = await StudySession.start(deps, deck);
  await s.answer(3, 1000);
  expect(s.current()).toBeNull();
  expect(s.isComplete()).toBe(false);
  expect(s.nextLearningDueAt()).toBe(T0 + 10 * MIN);
  deps.clock.advance(5 * MIN);
  expect(s.current()).not.toBeNull();
});
