import { beforeEach, expect, test } from 'vitest';
import { getCard } from '../../src/data/cards';
import { updateSettings } from '../../src/data/settings';
import { StudySession, type SessionDeps } from '../../src/services/studySession';
import { UndoStack } from '../../src/services/undo';
import { createMigratedDb } from '../helpers/testDb';
import { fixedClock, MIN, T0 } from '../helpers/fixtures';
import { seedDeck, seedNote } from '../helpers/seed';

// The card on screen stays the card acted on, even when a learning card falls due meanwhile (spec 6.5 rule 7).
let deps: SessionDeps & { clock: ReturnType<typeof fixedClock> };
let a: number;
let b: number;
let s: StudySession;
beforeEach(async () => {
  deps = { db: await createMigratedDb(), clock: fixedClock(T0), undo: new UndoStack() };
  await updateSettings(deps.db, { learnAheadMinutes: 0 });
  const deck = await seedDeck(deps.db, 'Chemistry');
  a = (await seedNote(deps, deck, 'basic', ['first', 'x'])).cardIds[0]!;
  b = (await seedNote(deps, deck, 'basic', ['second', 'x'])).cardIds[0]!;
  s = await StudySession.start(deps, deck);
  await s.answer(1, 1000, a); // first → 1 minute step
  expect(s.current()!.card.id).toBe(b);
  deps.clock.advance(2 * MIN); // first is due again while second is on screen
});

test('the card on screen can still be answered after a learning card falls due', async () => {
  expect(await s.answer(3, 1000, b)).toEqual({ leech: false });
  expect((await getCard(deps.db, b)).reps).toBe(1);
  expect((await getCard(deps.db, a)).reps).toBe(1);
});

test('bury, suspend and flag act on the given card, not the one picked by time', async () => {
  await s.setFlag(2, b);
  expect((await getCard(deps.db, b)).flag).toBe(2);
  expect((await getCard(deps.db, a)).flag).toBe(0);
  await s.buryCurrent(b);
  expect((await getCard(deps.db, b)).buriedKind).toBe('manual');
  expect((await getCard(deps.db, a)).buriedKind).toBeNull();
});

test('suspend acts on the given card', async () => {
  await s.suspendCurrent(b);
  expect((await getCard(deps.db, b)).suspended).toBe(true);
  expect((await getCard(deps.db, a)).suspended).toBe(false);
});

test('delete-note acts on the given card', async () => {
  await s.deleteCurrentNote(b);
  await expect(getCard(deps.db, b)).rejects.toThrow();
  expect((await getCard(deps.db, a)).id).toBe(a);
});

test('a just-answered learning card that is not yet due cannot be answered again', async () => {
  await s.answer(3, 1000, a); // first, due again, graded Good → 10 minute step
  expect(await s.answer(3, 1000, a)).toBeNull();
});

test('cardView renders a queued card by id', () => {
  expect(s.cardView(b)!.question).toBe('second');
  expect(s.cardView(9999)).toBeNull();
});
