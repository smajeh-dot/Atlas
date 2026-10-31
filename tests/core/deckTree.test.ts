import { expect, test } from 'vitest';
import { ancestorIds, buildDeckTree, descendantIds, fullName, treeOrder } from '../../src/core/deckTree';
import type { Deck } from '../../src/core/model';

const d = (id: number, name: string, parentId: number | null, position: number): Deck => ({
  id, name, parentId, presetId: 1, colour: null, position, collapsed: false, kind: 'normal', createdAt: 0,
});
const decks = [
  d(1, 'Biology', null, 1),
  d(2, 'Chemistry', null, 0),
  d(3, 'Genetics & Inheritance', 1, 1),
  d(4, 'Cell Structure', 1, 0),
  d(5, 'Meiosis', 3, 0),
];

test('tree and depth-first order follow position', () => {
  expect(buildDeckTree(decks).map((n) => n.deck.name)).toEqual(['Chemistry', 'Biology']);
  expect(treeOrder(decks)).toEqual([2, 1, 4, 3, 5]);
});

test('descendants include the deck itself; ancestors are nearest first', () => {
  expect(descendantIds(decks, 1).sort()).toEqual([1, 3, 4, 5]);
  expect(ancestorIds(decks, 5)).toEqual([3, 1]);
  expect(ancestorIds(decks, 1)).toEqual([]);
});

test('full names', () => {
  expect(fullName(decks, 3)).toBe('Biology › Genetics & Inheritance');
  expect(fullName(decks, 5, '::')).toBe('Biology::Genetics & Inheritance::Meiosis');
});
