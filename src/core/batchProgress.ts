/** How many cards the study progress bar holds before it starts again from empty. */
export const REVIEW_BATCH = 20;

/**
 * Where the current batch of `size` cards has got to: `done` answered out of `total` in it. `answered` and `remaining` count the
 * whole session. A batch is finished when `size` answers have been given and more cards remain, and the bar then starts again from empty;
 * the last batch may be shorter, and holds only the cards it actually has.
 */
export function batchCounts(answered: number, remaining: number, size = REVIEW_BATCH): { done: number; total: number } {
  // When nothing is left, the batch just finished is shown full rather than as a fresh, empty one.
  const done = remaining === 0 && answered > 0 ? ((answered - 1) % size) + 1 : answered % size;
  return { done, total: Math.min(size, done + remaining) };
}

/** How full the study progress bar is, from 0 to 1. */
export function batchProgress(answered: number, remaining: number, size = REVIEW_BATCH): number {
  const { done, total } = batchCounts(answered, remaining, size);
  return total === 0 ? 0 : done / total;
}
