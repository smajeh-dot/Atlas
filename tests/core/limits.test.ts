import { expect, test } from 'vitest';
import { planCards, selectWithinLimits, type LimitNode } from '../../src/core/limits';
import { oneCardPerNote } from '../../src/core/queue';
import type { Card } from '../../src/core/model';

const node = (deckId: number, parentId: number | null, newRemaining: number, reviewRemaining = 200): LimitNode => ({ deckId, parentId, newRemaining, reviewRemaining });
const cards = (deckId: number, n: number, start = 0) => Array.from({ length: n }, (_, i) => ({ id: start + i, deckId }));

test('a parent limit caps its children together', () => {
  const nodes = [node(1, null, 20), node(2, 1, 200), node(3, 1, 200)];
  const picked = selectWithinLimits('new', [...cards(2, 15), ...cards(3, 15, 100)], nodes);
  expect(picked).toHaveLength(20);
  expect(picked.filter((id) => id < 100)).toHaveLength(15);
});

test('a child limit applies inside a larger parent limit', () => {
  const nodes = [node(1, null, 20), node(2, 1, 5), node(3, 1, 200)];
  const picked = selectWithinLimits('new', [...cards(2, 15), ...cards(3, 15, 100)], nodes);
  expect(picked.filter((id) => id < 100)).toHaveLength(5);
  expect(picked).toHaveLength(20);
});

test('review limits are separate from new limits and nodes are not mutated', () => {
  const nodes = [node(1, null, 0, 3)];
  expect(selectWithinLimits('review', cards(1, 10), nodes)).toEqual([0, 1, 2]);
  expect(selectWithinLimits('new', cards(1, 10), nodes)).toEqual([]);
  expect(nodes[0]!.reviewRemaining).toBe(3);
});

const card = (id: number, noteId: number, state: 0 | 2, deckId = 1): Card => ({
  id, noteId, ord: 0, deckId, originalDeckId: null, state, dueAt: state ? 0 : null, newPosition: state ? null : id,
  stability: 0, difficulty: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, lastReviewAt: null,
  suspended: false, buriedDay: null, buriedKind: null, flag: 0, createdAt: 0, updatedAt: 0,
});

test('one card per note, skipping notes already taken', () => {
  const list = [card(1, 10, 0), card(2, 10, 0), card(3, 11, 0)];
  expect(oneCardPerNote(list).map((c) => c.id)).toEqual([1, 3]);
  expect(oneCardPerNote(list, new Set([11])).map((c) => c.id)).toEqual([1]);
});

test('planCards buries new siblings of reviews when the preset says so', () => {
  const out = planCards({
    newCards: [card(1, 10, 0), card(3, 11, 0)],
    reviewCards: [card(2, 10, 2)],
    nodes: [node(1, null, 20)],
    options: { buryNewSiblings: true, buryReviewSiblings: true },
  });
  expect(out.reviewCards.map((c) => c.id)).toEqual([2]);
  expect(out.newCards.map((c) => c.id)).toEqual([3]);
  const off = planCards({
    newCards: [card(1, 10, 0)], reviewCards: [card(2, 10, 2)], nodes: [node(1, null, 20)],
    options: { buryNewSiblings: false, buryReviewSiblings: false },
  });
  expect(off.newCards).toHaveLength(1);
});
