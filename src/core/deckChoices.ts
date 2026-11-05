import type { Deck } from './model';
import { descendantIds, treeOrder } from './deckTree';

/**
 * A subject is a top-level deck that has decks inside it (Chemistry, with Organic and Inorganic under it). It only groups its
 * decks: cards go into the decks, never into the subject itself. A top-level deck with nothing inside it is a deck.
 */
export function isSubject(decks: Deck[], deck: Deck): boolean {
  return deck.parentId === null && decks.some((d) => d.parentId === deck.id);
}

/** Every deck a card can be added to, in the order they appear in the deck tree. Subjects are left out. */
export function cardDecks(decks: Deck[]): Deck[] {
  const byId = new Map(decks.map((d) => [d.id, d]));
  return treeOrder(decks)
    .map((id) => byId.get(id)!)
    .filter((d) => !isSubject(decks, d));
}

/**
 * The deck a new card should go into: the first of `candidates` (a deck chosen, the deck a menu was opened on, the last deck used)
 * that exists. A subject stands for its first deck, and with no usable candidate it's the first deck there is.
 */
export function pickCardDeck(decks: Deck[], candidates: (number | null | undefined)[]): Deck | undefined {
  const choices = cardDecks(decks);
  for (const id of candidates) {
    if (id == null) continue;
    const found = choices.find((d) => d.id === id);
    if (found) return found;
    const inside = new Set(descendantIds(decks, id));
    const first = choices.find((d) => inside.has(d.id));
    if (first) return first;
  }
  return choices[0];
}
