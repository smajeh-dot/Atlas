import { buildDeckTree, descendantIds, treeOrder, type DeckNode } from '../core/deckTree';
import { planCards, type LimitNode } from '../core/limits';
import { seededShuffle } from '../core/random';
import type { Card, Deck, PresetConfig } from '../core/model';
import { nextRollover, startOfStudyDay, studyDay } from '../core/studyDay';
import type { Db } from '../data/db';
import { listDecks } from '../data/decks';
import { listPresets } from '../data/presets';
import { toCard } from '../data/rows';
import { getSettings } from '../data/settings';

export interface DeckCounts {
  new: number;
  learn: number;
  review: number;
}

export interface DeckTreeWithCounts {
  deck: Deck;
  counts: DeckCounts;
  children: DeckTreeWithCounts[];
}

export interface StudyPlan {
  preset: PresetConfig;
  newCards: Card[];
  reviewCards: Card[];
  /** Learning cards on a step of a day or more, due today. */
  interdayLearning: Card[];
  /** Learning cards on a same-day step, due before the next rollover. */
  learning: Card[];
}

interface Candidates {
  newCards: Card[];
  reviewCards: Card[];
  interdayLearning: Card[];
  intradayLearning: Card[];
}

const sumBy = (rows: { deck_id: number; n: number }[]) => new Map(rows.map((r) => [Number(r.deck_id), Number(r.n)]));

export async function getLimitNodes(db: Db, now: number, dayStartHour: number, decks?: Deck[]): Promise<LimitNode[]> {
  const all = decks ?? (await listDecks(db));
  const presets = new Map((await listPresets(db)).map((p) => [p.id, p.config]));
  const today = studyDay(now, dayStartHour);
  const start = startOfStudyDay(today, dayStartHour);
  // An upper bound too, so answers logged under a wrong (future) clock never count as today.
  const end = startOfStudyDay(today + 1, dayStartHour);
  const newDone = sumBy(await db.query(
    `SELECT c.deck_id, COUNT(*) AS n FROM cards c
     JOIN (SELECT card_id, MIN(id) AS first FROM revlog GROUP BY card_id) f ON f.card_id = c.id
     WHERE f.first >= ? AND f.first < ? GROUP BY c.deck_id`, [start, end]));
  const reviewsDone = sumBy(await db.query(
    `SELECT c.deck_id, COUNT(*) AS n FROM revlog r JOIN cards c ON c.id = r.card_id
     WHERE r.id >= ? AND r.id < ? AND r.state_before = 2 GROUP BY c.deck_id`, [start, end]));
  return all.map((d) => {
    const sub = descendantIds(all, d.id);
    const used = (m: Map<number, number>) => sub.reduce((s, id) => s + (m.get(id) ?? 0), 0);
    const cfg = presets.get(d.presetId) ?? presets.get(1)!;
    return {
      deckId: d.id,
      parentId: d.parentId,
      newRemaining: Math.max(0, cfg.newPerDay - used(newDone)),
      reviewRemaining: Math.max(0, cfg.reviewsPerDay - used(reviewsDone)),
    };
  });
}

export async function getDueCandidates(db: Db, deckIds: number[], now: number, dayStartHour: number): Promise<Candidates> {
  const empty = { newCards: [], reviewCards: [], interdayLearning: [], intradayLearning: [] };
  if (!deckIds.length) return empty;
  const marks = deckIds.map(() => '?').join(',');
  const rows = (await db.query(
    `SELECT * FROM cards WHERE deck_id IN (${marks}) AND suspended = 0
     AND (buried_day IS NULL OR buried_day != ?) AND (state = 0 OR due_at < ?)
     ORDER BY new_position, ord, due_at, id`,
    [...deckIds, studyDay(now, dayStartHour), nextRollover(now, dayStartHour)],
  )).map(toCard);
  const learning = rows.filter((c) => c.state === 1 || c.state === 3);
  return {
    newCards: rows.filter((c) => c.state === 0),
    reviewCards: rows.filter((c) => c.state === 2),
    interdayLearning: learning.filter((c) => c.scheduledDays >= 1),
    intradayLearning: learning.filter((c) => c.scheduledDays < 1),
  };
}

interface Context {
  seed: number;
  decks: Deck[];
  presets: Map<number, PresetConfig>;
  nodes: LimitNode[];
  candidates: Candidates;
}

async function loadContext(db: Db, now: number): Promise<Context> {
  const { dayStartHour } = await getSettings(db);
  const decks = await listDecks(db);
  const order = new Map(treeOrder(decks).map((id, i) => [id, i]));
  const candidates = await getDueCandidates(db, decks.map((d) => d.id), now, dayStartHour);
  // New cards come deck by deck in tree order, then in the order they were added.
  candidates.newCards.sort((a, b) =>
    (order.get(a.deckId) ?? 0) - (order.get(b.deckId) ?? 0) || (a.newPosition ?? 0) - (b.newPosition ?? 0) || a.ord - b.ord);
  candidates.reviewCards.sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0) || a.id - b.id);
  return {
    seed: studyDay(now, dayStartHour),
    decks,
    presets: new Map((await listPresets(db)).map((p) => [p.id, p.config])),
    nodes: await getLimitNodes(db, now, dayStartHour, decks),
    candidates,
  };
}

function planFor(ctx: Context, deckId: number | null): StudyPlan {
  const ids = new Set(deckId === null ? ctx.decks.map((d) => d.id) : descendantIds(ctx.decks, deckId));
  const inScope = (cards: Card[]) => cards.filter((c) => ids.has(c.deckId));
  const deck = ctx.decks.find((d) => d.id === deckId);
  const preset = ctx.presets.get(deck?.presetId ?? 1) ?? ctx.presets.get(1)!;
  const scopedNew = inScope(ctx.candidates.newCards);
  const picked = planCards({
    // Shuffle before the daily limit so "random" can reach any new card, not just the next ones added.
    newCards: preset.newCardOrder === 'random' ? seededShuffle(scopedNew, ctx.seed) : scopedNew,
    reviewCards: inScope(ctx.candidates.reviewCards),
    nodes: ctx.nodes,
    options: preset,
  });
  return {
    preset,
    ...picked,
    interdayLearning: inScope(ctx.candidates.interdayLearning),
    learning: inScope(ctx.candidates.intradayLearning),
  };
}

/** The cards a session on `deckId` (or all decks) would show today. Deck counts use the same plan, so they always agree. */
export async function planStudy(db: Db, deckId: number | null, now: number): Promise<StudyPlan> {
  return planFor(await loadContext(db, now), deckId);
}

export async function getDeckTreeWithCounts(db: Db, now: number): Promise<DeckTreeWithCounts[]> {
  const ctx = await loadContext(db, now);
  const walk = (nodes: DeckNode[]): DeckTreeWithCounts[] =>
    nodes.map((n) => {
      const p = planFor(ctx, n.deck.id);
      return {
        deck: n.deck,
        counts: { new: p.newCards.length, learn: p.learning.length + p.interdayLearning.length, review: p.reviewCards.length },
        children: walk(n.children),
      };
    });
  return walk(buildDeckTree(ctx.decks));
}
