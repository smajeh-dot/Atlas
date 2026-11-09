import { answerCram, isComplete, startRound, type CramState, type Rng } from '../core/cram';
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
    const state = startRound(pool, 1, rng);
    const session = new CramSession(deps, deckId, rng, decks, state);
    session.front = await session.loadFront(state, decks);
    return session;
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

  /** Task 3 saves the state; until then nothing is stored. */
  private async persist(): Promise<boolean> {
    return true;
  }
}
