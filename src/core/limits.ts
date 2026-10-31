import type { Card } from './model';
import { oneCardPerNote } from './queue';

export interface LimitNode {
  deckId: number;
  parentId: number | null;
  newRemaining: number;
  reviewRemaining: number;
}

/**
 * Walks `cards` in order and takes a card only while its deck and every
 * ancestor deck still have room today; each card taken uses up room in all of them.
 */
export function selectWithinLimits(kind: 'new' | 'review', cards: { id: number; deckId: number }[], nodes: LimitNode[]): number[] {
  const byId = new Map(nodes.map((n) => [n.deckId, n]));
  const left = new Map(nodes.map((n) => [n.deckId, kind === 'new' ? n.newRemaining : n.reviewRemaining]));
  const path = (deckId: number): number[] => {
    const out: number[] = [];
    for (let id: number | null = deckId; id !== null && !out.includes(id); id = byId.get(id)?.parentId ?? null) out.push(id);
    return out;
  };
  const taken: number[] = [];
  for (const c of cards) {
    const p = path(c.deckId);
    if (p.every((id) => (left.get(id) ?? 0) > 0)) {
      p.forEach((id) => left.set(id, left.get(id)! - 1));
      taken.push(c.id);
    }
  }
  return taken;
}

export interface PlanOptions {
  buryNewSiblings: boolean;
  buryReviewSiblings: boolean;
}

/** Today's new and review cards after sibling burying and daily limits, in the order given. */
export function planCards(input: { newCards: Card[]; reviewCards: Card[]; nodes: LimitNode[]; options: PlanOptions }): {
  newCards: Card[];
  reviewCards: Card[];
} {
  const { options, nodes } = input;
  const reviews = options.buryReviewSiblings ? oneCardPerNote(input.reviewCards) : input.reviewCards;
  const reviewIds = new Set(selectWithinLimits('review', reviews, nodes));
  const reviewCards = reviews.filter((c) => reviewIds.has(c.id));
  const news = options.buryNewSiblings
    ? oneCardPerNote(input.newCards, new Set(reviewCards.map((c) => c.noteId)))
    : input.newCards;
  const newIds = new Set(selectWithinLimits('new', news, nodes));
  return { newCards: news.filter((c) => newIds.has(c.id)), reviewCards };
}
