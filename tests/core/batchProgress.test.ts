import { expect, test } from 'vitest';
import { batchProgress } from '../../src/core/batchProgress';

test('the bar fills across 20 cards, not the whole session', () => {
  expect(batchProgress(0, 50)).toBe(0);
  expect(batchProgress(5, 45)).toBe(0.25);
  expect(batchProgress(19, 31)).toBe(0.95);
});

test('it starts again from empty after every 20 answers', () => {
  expect(batchProgress(20, 30)).toBe(0);
  expect(batchProgress(30, 20)).toBe(0.5);
  expect(batchProgress(40, 10)).toBe(0);
});

test('a short last batch fills by the cards it holds, and the finished session is full', () => {
  expect(batchProgress(45, 7)).toBe(5 / 12);
  expect(batchProgress(52, 0)).toBe(1);
  expect(batchProgress(40, 0)).toBe(1);
  expect(batchProgress(0, 0)).toBe(0);
});
