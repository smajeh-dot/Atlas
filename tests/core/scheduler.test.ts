import { expect, test } from 'vitest';
import { createEmptyCard, fsrs, generatorParameters, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import { answerCard, isIntraday, previewAll } from '../../src/core/scheduler';
import { DEFAULT_PRESET, type Card, type Rating } from '../../src/core/model';

const T0 = Date.UTC(2026, 0, 1, 10);
const MIN = 60_000;
const DAY = 86_400_000;

function newCard(id = 1): Card {
  return {
    id, noteId: 1, ord: 0, deckId: 1, originalDeckId: null, state: 0, dueAt: null, newPosition: 1,
    stability: 0, difficulty: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0,
    lastReviewAt: null, suspended: false, buriedDay: null, buriedKind: null, flag: 0,
    createdAt: T0, updatedAt: T0,
  };
}

function apply(card: Card, t: number, r: Rating, preset = DEFAULT_PRESET): Card {
  return { ...card, ...answerCard(card, t, r, preset).card };
}

/** New card answered Good twice: graduates to review. */
function graduated(id = 1): Card {
  let c = apply(newCard(id), T0, 3);
  c = apply(c, c.dueAt!, 3);
  return c;
}

test('Good on a new card goes to the 10m step', () => {
  const o = answerCard(newCard(), T0, 3, DEFAULT_PRESET);
  expect(o.card.state).toBe(1);
  expect(o.card.dueAt).toBe(T0 + 10 * MIN);
  expect(o.log.kind).toBe(0);
  expect(o.log.stateBefore).toBe(0);
  expect(o.log.rating).toBe(3);
  expect(isIntraday(o.card)).toBe(true);
});

test('Again on a new card goes to the 1m step', () => {
  expect(answerCard(newCard(), T0, 1, DEFAULT_PRESET).card.dueAt).toBe(T0 + MIN);
});

test('two Goods graduate the card to review', () => {
  const c = graduated();
  expect(c.state).toBe(2);
  expect(c.scheduledDays).toBeGreaterThanOrEqual(1);
  expect(isIntraday(c)).toBe(false);
});

test('preview equals the real answer 7 seconds later', () => {
  const c = graduated(42);
  const t = c.dueAt! + 3 * DAY;
  const p = previewAll(c, t, DEFAULT_PRESET);
  for (const r of [1, 2, 3, 4] as Rating[]) {
    const real = answerCard(c, t + 7000, r, DEFAULT_PRESET);
    expect(p[r].card.scheduledDays).toBe(real.card.scheduledDays);
    expect(p[r].card.state).toBe(real.card.state);
  }
  expect(p[4].card.scheduledDays).toBeGreaterThan(p[3].card.scheduledDays);
});

test('matches ts-fsrs directly with fuzz off', () => {
  const preset = { ...DEFAULT_PRESET, enableFuzz: false };
  const f = fsrs(generatorParameters({ enable_fuzz: false, enable_short_term: true, learning_steps: ['1m', '10m'], relearning_steps: ['10m'], request_retention: 0.9, maximum_interval: 36500 }));
  const ratings: Rating[] = [3, 3, 3, 1, 3, 4];
  let ours = newCard();
  let theirs: FsrsCard = createEmptyCard(new Date(T0));
  let t = T0;
  for (const r of ratings) {
    ours = apply(ours, t, r, preset);
    theirs = f.next(theirs, new Date(t), r as Grade).card;
    expect(ours.stability).toBeCloseTo(theirs.stability, 10);
    expect(ours.difficulty).toBeCloseTo(theirs.difficulty, 10);
    expect(ours.dueAt).toBe(theirs.due.getTime());
    expect(ours.state).toBe(theirs.state);
    t = ours.dueAt! + 2 * DAY;
  }
});

test('Again on a review card is a lapse', () => {
  const c = graduated();
  const o = answerCard(c, c.dueAt!, 1, DEFAULT_PRESET);
  expect(o.card.lapses).toBe(1);
  expect(o.card.state).toBe(3);
  expect(o.log.kind).toBe(1);
  expect(o.log.stateBefore).toBe(2);
  expect(o.card.dueAt).toBe(c.dueAt! + 10 * MIN);
});

test('elapsed days are measured from the last review', () => {
  const c = graduated();
  const o = answerCard(c, c.lastReviewAt! + 5 * DAY, 3, DEFAULT_PRESET);
  expect(o.log.elapsedDays).toBeCloseTo(5, 5);
  expect(o.card.lastReviewAt).toBe(c.lastReviewAt! + 5 * DAY);
});
