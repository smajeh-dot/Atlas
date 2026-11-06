/** How many cards the study progress bar holds before it starts again from empty. */
export const REVIEW_BATCH = 20;

/**
 * How full the study progress bar is, from 0 to 1. The bar covers one batch of `size` cards at a time:
 * it empties when a batch is finished and more cards remain, and the last batch (which may be shorter) fills
 * by however many cards it actually holds. `answered` and `remaining` count the whole session.
 */
export function batchProgress(answered: number, remaining: number, size = REVIEW_BATCH): number {
  // When nothing is left, the batch just finished is shown full rather than as a fresh, empty one.
  const inBatch = remaining === 0 && answered > 0 ? ((answered - 1) % size) + 1 : answered % size;
  const total = Math.min(size, inBatch + remaining);
  return total === 0 ? 0 : inBatch / total;
}
