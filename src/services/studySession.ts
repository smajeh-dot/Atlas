import { fullName } from '../core/deckTree';
import type { Card, Deck, Note, NoteType, PresetConfig, Rating } from '../core/model';
import { mixEvenly, orderReviews } from '../core/queue';
import { answerCard, isIntraday, previewAll } from '../core/scheduler';
import { nextRollover, studyDay } from '../core/studyDay';
import { renderCard } from '../core/templates';
import { cardsOfNote, cardUpdateStatement, getCard } from '../data/cards';
import { deleteNote } from './noteService';
import type { Db, Statement } from '../data/db';
import { listDecks } from '../data/decks';
import { listNoteTypes } from '../data/noteTypes';
import { getNote, noteUpdateStatement } from '../data/notes';
import { listPresets } from '../data/presets';
import { toNote } from '../data/rows';
import { nextRevlogId, revlogInsertStatement } from '../data/revlog';
import { getSettings } from '../data/settings';
import type { Settings } from '../core/model';
import { planStudy, type DeckCounts } from './deckService';
import type { UndoEntry, UndoStack } from './undo';

export interface SessionCard {
  card: Card;
  note: Note;
  noteType: NoteType;
  question: string;
  answer: string;
  /** Interval each rating would give, in ms from now. */
  previews: Record<Rating, number>;
  /** Template filters Atlas does not know; they render the raw field (shown in Card info). */
  unknownFilters: string[];
  /** Full deck name for the breadcrumb, e.g. "Chemistry › Organic". */
  deckName: string;
}

export interface SessionSummary {
  answers: number;
  durationMs: number;
  again: number;
}

export interface SessionDeps {
  db: Db;
  clock: { now(): number };
  undo: UndoStack;
}

const RATING_NAMES = ['Again', 'Hard', 'Good', 'Easy'] as const;
const MIN_MS = 60_000;

interface Snapshot {
  main: Card[];
  learning: Card[];
}

export class StudySession {
  private busy = false;
  private readonly snapshots = new WeakMap<UndoEntry, Snapshot>();
  /** What each undoable answer added to the summary, so undo can take it back. */
  private readonly answered = new WeakMap<UndoEntry, { rating: Rating; ms: number }>();
  private totals: SessionSummary = { answers: 0, durationMs: 0, again: 0 };

  private constructor(
    private readonly deps: SessionDeps,
    private readonly settings: Settings,
    private decks: Deck[],
    private readonly presets: Map<number, PresetConfig>,
    private readonly noteTypes: Map<number, NoteType>,
    private readonly notes: Map<number, Note>,
    /** Interday learning, then reviews mixed with new cards. */
    private main: Card[],
    /** Same-day learning cards, shown when due. */
    private learning: Card[],
  ) {}

  static async start(deps: SessionDeps, deckId: number | null): Promise<StudySession> {
    const { db } = deps;
    const now = deps.clock.now();
    const settings = await getSettings(db);
    const plan = await planStudy(db, deckId, now);
    const seed = studyDay(now, settings.dayStartHour);
    const reviews = orderReviews(plan.reviewCards, settings.dayStartHour, seed);
    const news = plan.newCards;
    const mixed =
      plan.preset.newReviewMix === 'newFirst' ? [...news, ...reviews]
      : plan.preset.newReviewMix === 'reviewsFirst' ? [...reviews, ...news]
      : mixEvenly(reviews, news);
    const byDue = (a: Card, b: Card) => (a.dueAt ?? 0) - (b.dueAt ?? 0);
    const main = [...plan.interdayLearning.sort(byDue), ...mixed];
    const learning = plan.learning.sort(byDue);
    const noteIds = [...new Set([...main, ...learning].map((c) => c.noteId))];
    const notes = noteIds.length
      ? (await db.query(`SELECT * FROM notes WHERE id IN (${noteIds.map(() => '?').join(',')})`, noteIds)).map(toNote)
      : [];
    return new StudySession(
      deps,
      settings,
      await listDecks(db),
      new Map((await listPresets(db)).map((p) => [p.id, p.config])),
      new Map((await listNoteTypes(db)).map((t) => [t.id, t])),
      new Map(notes.map((n) => [n.id, n])),
      main,
      learning,
    );
  }

  private presetOf(card: Card): PresetConfig {
    const deck = this.decks.find((d) => d.id === card.deckId);
    return this.presets.get(deck?.presetId ?? 1) ?? this.presets.get(1)!;
  }

  private pick(now: number): Card | null {
    const earliest = (limit: number) =>
      this.learning.filter((c) => (c.dueAt ?? 0) <= limit).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))[0];
    return (
      earliest(now) ??
      this.main[0] ??
      earliest(now + this.settings.learnAheadMinutes * MIN_MS) ??
      null
    );
  }

  current(): SessionCard | null {
    const now = this.deps.clock.now();
    const card = this.pick(now);
    if (!card) return null;
    const note = this.notes.get(card.noteId)!;
    const noteType = this.noteTypes.get(note.noteTypeId)!;
    const rendered = renderCard(noteType, note, card.ord, fullName(this.decks, card.deckId, '::'));
    const outcomes = previewAll(card, now, this.presetOf(card));
    const previews = {} as Record<Rating, number>;
    for (const r of [1, 2, 3, 4] as Rating[]) previews[r] = (outcomes[r].card.dueAt ?? now) - now;
    return {
      card, note, noteType, question: rendered.question, answer: rendered.answer, previews,
      unknownFilters: rendered.unknownFilters, deckName: fullName(this.decks, card.deckId),
    };
  }

  remaining(): DeckCounts {
    const all = [...this.main, ...this.learning];
    return {
      new: all.filter((c) => c.state === 0).length,
      learn: all.filter((c) => c.state === 1 || c.state === 3).length,
      review: all.filter((c) => c.state === 2).length,
    };
  }

  summary(): SessionSummary {
    return { ...this.totals };
  }

  isComplete(): boolean {
    return this.main.length === 0 && this.learning.length === 0;
  }

  nextLearningDueAt(): number | null {
    const due = this.learning.map((c) => c.dueAt ?? 0);
    return due.length ? Math.min(...due) : null;
  }

  private remove(ids: Set<number>): void {
    this.main = this.main.filter((c) => !ids.has(c.id));
    this.learning = this.learning.filter((c) => !ids.has(c.id));
  }

  private snapshot(): Snapshot {
    return { main: this.main.slice(), learning: this.learning.slice() };
  }

  /**
   * Grades the current card. Returns null if there is no card, an answer is already being saved,
   * or `expectedCardId` is given and is not the card on screen (a stray second key press).
   */
  async answer(rating: Rating, durationMs: number, expectedCardId?: number): Promise<{ leech: boolean } | null> {
    if (this.busy) return null;
    const card = this.pick(this.deps.clock.now());
    if (!card || (expectedCardId !== undefined && card.id !== expectedCardId)) return null;
    this.busy = true;
    try {
      return await this.grade(card, rating, durationMs);
    } finally {
      this.busy = false;
    }
  }

  private async grade(card: Card, rating: Rating, durationMs: number): Promise<{ leech: boolean }> {
    const { db } = this.deps;
    const now = this.deps.clock.now();
    const preset = this.presetOf(card);
    const today = studyDay(now, this.settings.dayStartHour);
    const rollover = nextRollover(now, this.settings.dayStartHour);
    const outcome = answerCard(card, now, rating, preset);
    const updated: Card = { ...card, ...outcome.card, newPosition: null, buriedDay: null, buriedKind: null, updatedAt: now };

    const lapsed = card.state === 2 && rating === 1;
    const t = preset.leechThreshold;
    const leech = lapsed && updated.lapses >= t && (updated.lapses - t) % Math.ceil(t / 2) === 0;
    const note = this.notes.get(card.noteId) ?? (await getNote(db, card.noteId));
    const statements: Statement[] = [];
    const restore: Statement[] = [cardUpdateStatement(card)];
    if (leech) {
      if (preset.leechAction === 'suspend') updated.suspended = true;
      if (!note.tags.some((x) => x.toLowerCase() === 'leech')) {
        const tagged = { ...note, tags: [...note.tags, 'leech'], updatedAt: now };
        statements.push(noteUpdateStatement(tagged));
        restore.push(noteUpdateStatement(note));
        this.notes.set(note.id, tagged);
      }
    }

    const siblings = (await cardsOfNote(db, card.noteId)).filter((s) => s.id !== card.id && !s.suspended && s.buriedDay !== today);
    const toBury = siblings.filter(
      (s) =>
        (s.state === 0 && preset.buryNewSiblings) ||
        (s.state === 2 && (s.dueAt ?? 0) < rollover && preset.buryReviewSiblings) ||
        ((s.state === 1 || s.state === 3) && s.scheduledDays >= 1 && (s.dueAt ?? 0) < rollover && preset.buryInterdaySiblings),
    );
    for (const s of toBury) {
      statements.push(cardUpdateStatement({ ...s, buriedDay: today, buriedKind: 'sibling', updatedAt: now }));
      restore.push(cardUpdateStatement(s));
    }

    const revlogId = await nextRevlogId(db, now);
    const ms = Math.min(Math.max(0, Math.round(durationMs)), preset.maxAnswerSeconds * 1000);
    statements.unshift(
      cardUpdateStatement(updated),
      revlogInsertStatement({
        id: revlogId,
        cardId: card.id,
        ...outcome.log,
        durationMs: ms,
      }),
    );
    restore.push({ sql: `DELETE FROM revlog WHERE id = ?`, params: [revlogId] });

    const before = this.snapshot();
    await db.batch(statements);

    const entry: UndoEntry = { label: `answer ${RATING_NAMES[rating - 1]}`, restore, cardId: card.id };
    this.snapshots.set(entry, before);
    this.answered.set(entry, { rating, ms });
    this.deps.undo.push(entry);
    this.totals = {
      answers: this.totals.answers + 1,
      durationMs: this.totals.durationMs + ms,
      again: this.totals.again + (rating === 1 ? 1 : 0),
    };

    this.remove(new Set([card.id, ...toBury.map((s) => s.id)]));
    if (!updated.suspended && isIntraday(updated) && (updated.dueAt ?? 0) < rollover) this.learning.push(updated);
    return { leech };
  }

  private async changeCurrent(label: string, change: (c: Card, today: number) => Card, leaveQueue: boolean): Promise<void> {
    if (this.busy) return;
    const now = this.deps.clock.now();
    const card = this.pick(now);
    if (!card) return;
    this.busy = true;
    try {
      const changed = { ...change(card, studyDay(now, this.settings.dayStartHour)), updatedAt: now };
      const before = this.snapshot();
      await this.deps.db.batch([cardUpdateStatement(changed)]);
      const entry: UndoEntry = {
        label,
        restore: [cardUpdateStatement(card)],
        ...(leaveQueue ? { cardId: card.id } : {}),
      };
      this.snapshots.set(entry, before);
      this.deps.undo.push(entry);
      if (leaveQueue) this.remove(new Set([card.id]));
      else {
        const swap = (list: Card[]) => list.map((c) => (c.id === card.id ? changed : c));
        this.main = swap(this.main);
        this.learning = swap(this.learning);
      }
    } finally {
      this.busy = false;
    }
  }

  /** Hides the current card until the next study day. */
  buryCurrent(): Promise<void> {
    return this.changeCurrent('bury', (c, today) => ({ ...c, buriedDay: today, buriedKind: 'manual' }), true);
  }

  suspendCurrent(): Promise<void> {
    return this.changeCurrent('suspend', (c) => ({ ...c, suspended: true }), true);
  }

  /** 0 clears the flag; 1-7 are the flag colours. */
  setFlag(flag: number): Promise<void> {
    return this.changeCurrent('flag', (c) => ({ ...c, flag }), false);
  }

  /** Reloads a card and its note after they were edited elsewhere (Edit card), so the screen shows the change. */
  async refreshCard(cardId: number): Promise<void> {
    const { db } = this.deps;
    const card = await getCard(db, cardId);
    this.notes.set(card.noteId, await getNote(db, card.noteId));
    this.decks = await listDecks(db);
    const swap = (list: Card[]) => list.map((c) => (c.id === cardId ? card : c));
    this.main = swap(this.main);
    this.learning = swap(this.learning);
  }

  /** Deletes the note of the card on screen. Undo restores it and shows that card again. */
  async deleteCurrentNote(): Promise<void> {
    if (this.busy) return;
    const card = this.pick(this.deps.clock.now());
    if (!card) return;
    this.busy = true;
    try {
      const before = this.snapshot();
      const entry = await deleteNote(this.deps, card.noteId);
      entry.cardId = card.id;
      this.snapshots.set(entry, before);
      const gone = new Set([...this.main, ...this.learning].filter((c) => c.noteId === card.noteId).map((c) => c.id));
      this.remove(gone);
    } finally {
      this.busy = false;
    }
  }

  /** Undo of an action from outside the session (such as "add card") can delete queued cards. */
  private async dropMissingCards(): Promise<void> {
    const queued = [...this.main, ...this.learning].map((c) => c.id);
    if (!queued.length) return;
    const rows = await this.deps.db.query<{ id: number }>(
      `SELECT id FROM cards WHERE id IN (${queued.map(() => '?').join(',')})`,
      queued,
    );
    const alive = new Set(rows.map((r) => Number(r.id)));
    this.remove(new Set(queued.filter((id) => !alive.has(id))));
  }

  /** Undoes the most recent action. Returns its label, or null when there is nothing to undo. */
  async undo(): Promise<string | null> {
    if (this.busy) return null;
    const entry = this.deps.undo.pop();
    if (!entry) return null;
    this.busy = true;
    try {
      return await this.restore(entry);
    } finally {
      this.busy = false;
    }
  }

  private async restore(entry: UndoEntry): Promise<string> {
    await this.deps.db.batch(entry.restore);
    const done = this.answered.get(entry);
    if (done) {
      this.totals = {
        answers: this.totals.answers - 1,
        durationMs: this.totals.durationMs - done.ms,
        again: this.totals.again - (done.rating === 1 ? 1 : 0),
      };
    }
    const snap = this.snapshots.get(entry);
    if (snap) {
      this.main = snap.main;
      this.learning = snap.learning;
    }
    if (entry.cardId !== undefined) {
      try {
        const card = await getCard(this.deps.db, entry.cardId);
        this.notes.set(card.noteId, await getNote(this.deps.db, card.noteId));
        this.remove(new Set([card.id]));
        this.main.unshift(card);
      } catch {
        // The card no longer exists (for example, its note was deleted later); nothing to show.
      }
    }
    await this.dropMissingCards();
    return entry.label;
  }
}
