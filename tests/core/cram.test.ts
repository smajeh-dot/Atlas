import { describe, expect, test } from 'vitest';
import {
  MAX_GAP,
  MIN_GAP,
  answerCram,
  isComplete,
  pruneState,
  startRound,
  type CramState,
} from '../../src/core/cram';
import { mulberry32, seededShuffle, shuffle } from '../../src/core/random';

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const stateOf = (queue: number[], pool: number[] = queue): CramState => ({
  round: 1,
  pool,
  queue,
  right: 0,
  wrong: 0,
});

describe('random', () => {
  test('seededShuffle keeps its output for a fixed seed', () => {
    expect(seededShuffle(range(10), 12345)).toEqual([7, 5, 9, 1, 2, 8, 6, 4, 3, 10]);
  });

  test('shuffle returns a copy and matches seededShuffle for the same generator', () => {
    const items = range(10);
    const out = shuffle(items, mulberry32(12345));
    expect(items).toEqual(range(10));
    expect(out).toEqual(seededShuffle(items, 12345));
  });
});

describe('startRound', () => {
  test('queues every pool id exactly once and leaves the pool alone', () => {
    const pool = range(20);
    const state = startRound(pool, 1, mulberry32(7));
    expect([...state.queue].sort((a, b) => a - b)).toEqual(pool);
    expect(state.pool).toEqual(pool);
    expect(state).toMatchObject({ round: 1, right: 0, wrong: 0 });
  });

  test('same seed gives the same order, different seeds can differ', () => {
    const pool = range(20);
    expect(startRound(pool, 1, mulberry32(7)).queue).toEqual(startRound(pool, 1, mulberry32(7)).queue);
    const orders = new Set(
      [1, 2, 3, 4, 5].map((seed) => startRound(pool, 1, mulberry32(seed)).queue.join(',')),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  test('records the round number it was given', () => {
    expect(startRound([1, 2], 3, mulberry32(1)).round).toBe(3);
  });
});

describe('answerCram', () => {
  test('right removes the front card and keeps the order of the rest', () => {
    const next = answerCram(stateOf([1, 2, 3, 4]), true, () => 0);
    expect(next.queue).toEqual([2, 3, 4]);
    expect(next.right).toBe(1);
    expect(next.wrong).toBe(0);
  });

  test('wrong with the lowest draw puts the card after exactly MIN_GAP others', () => {
    expect(MIN_GAP).toBe(3);
    const next = answerCram(stateOf(range(12)), false, () => 0);
    expect(next.queue).toEqual([2, 3, 4, 1, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(next.wrong).toBe(1);
    expect(next.right).toBe(0);
  });

  test('wrong with the highest draw puts the card after exactly MAX_GAP others', () => {
    expect(MAX_GAP).toBe(9);
    const next = answerCram(stateOf(range(12)), false, () => 0.999);
    expect(next.queue).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 11, 12]);
    expect(next.wrong).toBe(1);
  });

  test('wrong keeps every id in the queue exactly once', () => {
    const next = answerCram(stateOf(range(12)), false, () => 0.5);
    expect([...next.queue].sort((a, b) => a - b)).toEqual(range(12));
  });

  test('wrong with fewer others than the gap goes to the end', () => {
    expect(answerCram(stateOf([1, 2]), false, () => 0).queue).toEqual([2, 1]);
  });

  test('one-card pool: wrong keeps the card, right completes the round', () => {
    const one = stateOf([1]);
    const wrong = answerCram(one, false, () => 0);
    expect(wrong.queue).toEqual([1]);
    expect(isComplete(wrong)).toBe(false);
    expect(isComplete(answerCram(one, true, () => 0))).toBe(true);
  });

  test('the missed card is never the next front while another card exists', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 200; i++) {
      const size = 2 + Math.floor(rng() * 15);
      const next = answerCram(stateOf(range(size)), false, rng);
      expect(next.queue[0]).not.toBe(1);
    }
  });

  test('an empty queue returns the state unchanged', () => {
    const done = stateOf([], [1, 2]);
    expect(answerCram(done, true, () => 0)).toEqual(done);
    expect(answerCram(done, false, () => 0)).toEqual(done);
  });

  test('does not mutate its input', () => {
    const state = stateOf(range(6));
    const copy = structuredClone(state);
    answerCram(state, false, () => 0.5);
    answerCram(state, true, () => 0.5);
    expect(state).toEqual(copy);
  });

  test('simulation: a 40% error rate still ends with every card right exactly once', () => {
    const rng = mulberry32(2024);
    const pool = range(30);
    let state = startRound(pool, 1, rng);
    const rightIds: number[] = [];
    let wrongAnswers = 0;
    let steps = 0;
    while (!isComplete(state)) {
      expect(++steps).toBeLessThan(10_000);
      const front = state.queue[0]!;
      const right = rng() >= 0.4;
      if (right) rightIds.push(front);
      else wrongAnswers++;
      state = answerCram(state, right, rng);
    }
    expect(rightIds.sort((a, b) => a - b)).toEqual(pool);
    expect(state.right).toBe(30);
    expect(state.wrong).toBe(wrongAnswers);
  });
});

describe('pruneState', () => {
  test('drops missing ids from pool and queue and keeps order', () => {
    const state: CramState = { round: 2, pool: [1, 2, 3, 4, 5], queue: [4, 2, 5, 1], right: 1, wrong: 2 };
    expect(pruneState(state, new Set([1, 4, 5]))).toEqual({
      round: 2,
      pool: [1, 4, 5],
      queue: [4, 5, 1],
      right: 1,
      wrong: 2,
    });
  });
});
