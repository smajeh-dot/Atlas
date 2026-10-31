import { expect, test } from 'vitest';
import { mixEvenly, orderReviews } from '../../src/core/queue';
import type { Card } from '../../src/core/model';

test('80 reviews and 20 new: one new card after every 4 reviews', () => {
  const reviews = Array.from({ length: 80 }, (_, i) => `r${i}`);
  const news = Array.from({ length: 20 }, (_, i) => `n${i}`);
  const mixed = mixEvenly(reviews, news);
  expect(mixed).toHaveLength(100);
  expect(mixed.slice(0, 10)).toEqual(['r0', 'r1', 'r2', 'r3', 'n0', 'r4', 'r5', 'r6', 'r7', 'n1']);
  expect(mixed.at(-1)).toBe('n19');
});

test('mixing with nothing on one side', () => {
  expect(mixEvenly([], ['a', 'b'])).toEqual(['a', 'b']);
  expect(mixEvenly(['a', 'b'], [])).toEqual(['a', 'b']);
});

const review = (id: number, dueAt: number): Card => ({
  id, noteId: id, ord: 0, deckId: 1, originalDeckId: null, state: 2, dueAt, newPosition: null, stability: 1,
  difficulty: 5, scheduledDays: 1, learningSteps: 0, reps: 1, lapses: 0, lastReviewAt: 0, suspended: false,
  buriedDay: null, buriedKind: null, flag: 0, createdAt: 0, updatedAt: 0,
});

test('reviews: oldest study day first, stable random order within a day', () => {
  const day1 = Date.UTC(2026, 9, 20, 12);
  const day2 = Date.UTC(2026, 9, 21, 12);
  const cards = [review(1, day2), review(2, day1), review(3, day2), review(4, day1), review(5, day2)];
  const a = orderReviews(cards, 4, 99).map((c) => c.id);
  expect(new Set(a.slice(0, 2))).toEqual(new Set([2, 4]));
  expect(orderReviews(cards, 4, 99).map((c) => c.id)).toEqual(a);
});
