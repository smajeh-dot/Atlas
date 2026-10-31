import { hash32 } from './random';
import { studyDay } from './studyDay';
import type { Card } from './model';

/** Keeps the first card of each note, skipping notes already in `taken` (sibling burying). */
export function oneCardPerNote(cards: Card[], taken: Set<number> = new Set()): Card[] {
  const seen = new Set(taken);
  return cards.filter((c) => (seen.has(c.noteId) ? false : (seen.add(c.noteId), true)));
}

/** Spreads new cards evenly through the reviews: 80 reviews and 20 new gives one new card after every 4 reviews. */
export function mixEvenly<T>(reviews: T[], news: T[]): T[] {
  const R = reviews.length;
  const N = news.length;
  const out: T[] = [];
  let i = 0;
  reviews.forEach((r, j) => {
    out.push(r);
    while (i < N && ((i + 1) * R) / N <= j + 1) out.push(news[i++]!);
  });
  while (i < N) out.push(news[i++]!);
  return out;
}

/** Oldest study day first; within a day, a random order that stays the same all day. */
export function orderReviews(cards: Card[], dayStartHour: number, seed: number): Card[] {
  const key = (c: Card) => studyDay(c.dueAt ?? 0, dayStartHour);
  return cards.slice().sort((a, b) => key(a) - key(b) || hash32(a.id, seed) - hash32(b.id, seed));
}
