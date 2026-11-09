import { answerCram, isComplete, pruneState, startRound, type CramState, type Rng } from '../core/cram';
import { descendantIds, fullName } from '../core/deckTree';
import type { Card, Deck, Note, NoteType } from '../core/model';
import { hash32, mulberry32 } from '../core/random';
import { renderCard } from '../core/templates';
import { getCard } from '../data/cards';
import type { Db } from '../data/db';
import { listDecks } from '../data/decks';
import { getNoteType } from '../data/noteTypes';
import { getNote } from '../data/notes';

export interface CramDeps {
  db: Db;
  clock: { now(): number };
  /** Draws the shuffles and the gaps. Defaults to a generator seeded from the clock and the deck. */
  rng?: Rng;
}

export interface CramCard {
  card: Card;
  note: Note;
  noteType: NoteType;
  question: string;
  answer: string;
}

export interface SaveResult {
  saved: boolean;
}

/** The `meta` row that holds the saved round of a deck. */
export const cramKey = (deckId: number): string => `cram:${deckId}`;

const isIds = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => Number.isInteger(x));
const isCount = (v: unknown, min: number): v is number => Number.isInteger(v) && (v as number) >= min;

/** The saved round, or null if the text is not exactly what `persist` writes. */
function parseSaved(raw: string): CramState | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.version !== 1 || !isCount(o.round, 1) || !isCount(o.right, 0) || !isCount(o.wrong, 0)) return null;
  if (!isIds(o.pool) || !isIds(o.queue)) return null;
  const pool = new Set(o.pool);
  const queue = new Set(o.queue);
  if (pool.size !== o.pool.length || queue.size !== o.queue.length) return null;
  if (!o.queue.every((id) => pool.has(id))) return null;
  return { round: o.round, pool: o.pool, queue: o.queue, right: o.right, wrong: o.wrong };
}

/**
 * A Right/Wrong round over a deck, kept apart from the schedule: it reads cards but never writes
 * `cards`, `notes` or `revlog`.
 */
export class CramSession {
  private busy = false;
  /** The state before each answer, newest last. Not persisted. */
  private history: CramState[] = [];
  private front: CramCard | null = null;

  private constructor(
    private readonly deps: CramDeps,
    private readonly deckId: number,
    private readonly rng: Rng,
    private decks: Deck[],
    private cram: CramState,
  ) {}

  static async open(deps: CramDeps, deckId: number): Promise<CramSession> {
    const rng = deps.rng ?? mulberry32(hash32(deps.clock.now(), deckId));
    const decks = await listDecks(deps.db);
    const pool = await CramSession.readPool(deps.db, decks, deckId);
    const state = await CramSession.resumeOrStart(deps.db, deckId, pool, rng);
    const session = new CramSession(deps, deckId, rng, decks, state);
    session.front = await session.loadFront(state, decks);
    return session;
  }

  /**
   * Continues the saved round, limited to the cards that are still eligible (new cards are not added
   * mid-round). Nothing usable saved starts round 1; a saved round with no cards left starts the next one.
   */
  private static async resumeOrStart(db: Db, deckId: number, pool: number[], rng: Rng): Promise<CramState> {
    const [row] = await db.query<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [cramKey(deckId)]);
    const savedState = row ? parseSaved(String(row.value)) : null;
    if (!savedState) return startRound(pool, 1, rng);
    const kept = pruneState(savedState, new Set(pool));
    return kept.queue.length > 0 ? kept : startRound(pool, savedState.round + 1, rng);
  }

  /** Every card of the deck and its subdecks that is not suspended, whatever its schedule says. */
  private static async readPool(db: Db, decks: Deck[], deckId: number): Promise<number[]> {
    const ids = descendantIds(decks, deckId);
    const rows = await db.query<{ id: number }>(
      `SELECT id FROM cards WHERE deck_id IN (${ids.map(() => '?').join(',')}) AND suspended = 0 ORDER BY id`,
      ids,
    );
    return rows.map((r) => Number(r.id));
  }

  state(): CramState {
    return this.cram;
  }

  current(): CramCard | null {
    return this.front;
  }

  isComplete(): boolean {
    return isComplete(this.cram);
  }

  isEmpty(): boolean {
    return this.cram.pool.length === 0;
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  /**
   * Marks the front card Right or Wrong. Returns null if nothing was done: an answer is already
   * being handled, there is no card, or `expectedCardId` is given and is not the front card.
   */
  async answer(right: boolean, expectedCardId?: number): Promise<SaveResult | null> {
    if (this.busy) return null;
    const frontId = this.cram.queue[0];
    if (frontId === undefined) return null;
    if (expectedCardId !== undefined && expectedCardId !== frontId) return null;
    this.busy = true;
    try {
      const next = answerCram(this.cram, right, this.rng);
      const front = await this.loadFront(next, this.decks);
      this.history.push(this.cram);
      this.cram = next;
      this.front = front;
      return { saved: await this.persist() };
    } finally {
      this.busy = false;
    }
  }

  /** Takes back the last answer. Returns null if there is nothing to take back. */
  async undo(): Promise<SaveResult | null> {
    if (this.busy) return null;
    const previous = this.history[this.history.length - 1];
    if (!previous) return null;
    this.busy = true;
    try {
      const front = await this.loadFront(previous, this.decks);
      this.history.pop();
      this.cram = previous;
      this.front = front;
      return { saved: await this.persist() };
    } finally {
      this.busy = false;
    }
  }

  /** A fresh shuffled round numbered 1; the undo history is cleared. */
  restart(): Promise<SaveResult> {
    return this.newRound(1);
  }

  /** The next round over the deck as it is now, reshuffled. */
  goAgain(): Promise<SaveResult> {
    return this.newRound(this.cram.round + 1);
  }

  private async newRound(round: number): Promise<SaveResult> {
    this.busy = true;
    try {
      const decks = await listDecks(this.deps.db);
      const pool = await CramSession.readPool(this.deps.db, decks, this.deckId);
      const next = startRound(pool, round, this.rng);
      const front = await this.loadFront(next, decks);
      this.decks = decks;
      this.cram = next;
      this.front = front;
      this.history = [];
      return { saved: await this.persist() };
    } finally {
      this.busy = false;
    }
  }

  /**
   * Loads the front card of `state` with its note and note type, so current() can answer
   * synchronously. It changes nothing, so a failed read leaves the session as it was.
   */
  private async loadFront(state: CramState, decks: Deck[]): Promise<CramCard | null> {
    const id = state.queue[0];
    if (id === undefined) return null;
    const { db } = this.deps;
    const card = await getCard(db, id);
    const note = await getNote(db, card.noteId);
    const noteType = await getNoteType(db, note.noteTypeId);
    const rendered = renderCard(noteType, note, card.ord, fullName(decks, card.deckId, '::'));
    return { card, note, noteType, question: rendered.question, answer: rendered.answer };
  }

  /** Saves the round, or removes the saved row once it is complete. False if the write failed. */
  private async persist(): Promise<boolean> {
    const { db } = this.deps;
    const key = cramKey(this.deckId);
    try {
      if (isComplete(this.cram)) {
        await db.execute(`DELETE FROM meta WHERE key = ?`, [key]);
      } else {
        const { round, pool, queue, right, wrong } = this.cram;
        const value = JSON.stringify({ version: 1, round, pool, queue, right, wrong });
        await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, value]);
      }
      return true;
    } catch {
      return false;
    }
  }
}
