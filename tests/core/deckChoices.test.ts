import { expect, test } from 'vitest';
import type { Deck } from '../../src/core/model';
import { cardDecks, isSubject, pickCardDeck } from '../../src/core/deckChoices';

let n = 0;
const deck = (name: string, parentId: number | null = null, position = n): Deck => ({
  id: ++n, name, parentId, presetId: 1, colour: null, position, collapsed: false, kind: 'normal', createdAt: 0,
});

// Chemistry (subject) > Organic > Alkanes, Inorganic; Maths (subject) > Algebra; Solo (a deck on its own).
const chemistry = deck('Chemistry', null, 0);
const organic = deck('Organic', chemistry.id, 0);
const alkanes = deck('Alkanes', organic.id, 0);
const inorganic = deck('Inorganic', chemistry.id, 1);
const maths = deck('Maths', null, 1);
const algebra = deck('Algebra', maths.id, 0);
const solo = deck('Solo', null, 2);
const decks = [solo, algebra, maths, inorganic, alkanes, organic, chemistry]; // deliberately not in tree order

test('a subject is a top-level deck with decks inside it', () => {
  expect(isSubject(decks, chemistry)).toBe(true);
  expect(isSubject(decks, maths)).toBe(true);
  expect(isSubject(decks, solo)).toBe(false);
  // Only top-level decks are subjects: Organic has decks inside it but is still a deck.
  expect(isSubject(decks, organic)).toBe(false);
});

test('cardDecks lists every deck that is not a subject, in tree order', () => {
  expect(cardDecks(decks).map((d) => d.name)).toEqual(['Organic', 'Alkanes', 'Inorganic', 'Algebra', 'Solo']);
});

test('pickCardDeck takes the first usable candidate; a subject stands for its first deck', () => {
  expect(pickCardDeck(decks, [alkanes.id, solo.id])?.name).toBe('Alkanes');
  expect(pickCardDeck(decks, [chemistry.id])?.name).toBe('Organic');
  expect(pickCardDeck(decks, [maths.id])?.name).toBe('Algebra');
  expect(pickCardDeck(decks, [null, undefined, 9999, solo.id])?.name).toBe('Solo');
  expect(pickCardDeck(decks, [null])?.name).toBe('Organic');
  expect(pickCardDeck([], [1])).toBeUndefined();
});
