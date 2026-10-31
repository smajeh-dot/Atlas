import type { Card } from './model';

/** Keeps the first card of each note, skipping notes already in `taken` (sibling burying). */
export function oneCardPerNote(cards: Card[], taken: Set<number> = new Set()): Card[] {
  const seen = new Set(taken);
  return cards.filter((c) => (seen.has(c.noteId) ? false : (seen.add(c.noteId), true)));
}
