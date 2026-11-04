/**
 * Converts Anki's scheduling into Atlas's, without ever answering an
 * imported card: a card comes due on the same day it would have in Anki.
 *
 * Due dates: Anki counts review due dates in days since the collection was
 * created; "today" in Anki is worked out by calendar date and rollover hour
 * (rslib scheduler/timing.rs), not by dividing seconds. A card due N days from
 * Anki's today is due N days from Atlas's today, so overdue cards stay overdue
 * by the same amount. Learning cards hold an exact time in seconds.
 *
 * Memory state, in strict priority:
 *  1. FSRS stability and difficulty stored on the card (Anki with FSRS on).
 *  2. Replaying the card's review history through Atlas's FSRS, read-only,
 *     on a scratch copy. The imported due date is always kept.
 *  3. An estimate from Anki's interval and ease, for review cards with no
 *     history. Counted in the report.
 *  4. Zeros for new cards.
 */
import { DEFAULT_PRESET, type Card, type PresetConfig, type Rating, type RevlogKind, type StateValue } from '../core/model';
import { answerCard } from '../core/scheduler';
import { startOfStudyDay, studyDay } from '../core/studyDay';
import type { SCard, SRevlog } from './staging';

const DAY_MS = 86_400_000;
/** Anki stores intraday learning due times as epoch seconds; day numbers are tiny by comparison. */
const EPOCH_SECONDS_THRESHOLD = 1_000_000_000;

export interface AnkiTiming {
  crtSecs: number;
  rolloverHour: number;
  /** Minutes west of UTC when the collection was created, if Anki recorded it. */
  creationOffsetMin: number | null;
}

/** Days since 1970 of a calendar date. */
const dayNumber = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / DAY_MS);

/**
 * Anki's day number at `nowMs` (v2/v3 scheduler): calendar days between the
 * creation date and today's date, less one if today's rollover hour hasn't
 * come yet.
 */
export function ankiToday(t: AnkiTiming, nowMs: number): number {
  let created: number;
  if (t.creationOffsetMin !== null) {
    const c = new Date(t.crtSecs * 1000 - t.creationOffsetMin * 60_000);
    created = dayNumber(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate());
  } else {
    const c = new Date(t.crtSecs * 1000);
    created = dayNumber(c.getFullYear(), c.getMonth(), c.getDate());
  }
  const now = new Date(nowMs);
  const today = dayNumber(now.getFullYear(), now.getMonth(), now.getDate());
  const passed = now.getHours() >= t.rolloverHour;
  return Math.max(0, today - created - (passed ? 0 : 1));
}

/** The Atlas due time for an Anki day number. */
export function dueAtForAnkiDay(ankiDue: number, ankiTodayNum: number, now: number, dayStartHour: number): number {
  return startOfStudyDay(studyDay(now, dayStartHour) + (ankiDue - ankiTodayNum), dayStartHour);
}

/** Maps Anki's ease factor (1300 = hardest, 2500 = default, higher = easier) to FSRS difficulty (10 = hardest, 1 = easiest). */
export function difficultyFromEase(factor: number): number {
  if (!factor) return 5;
  const d = 10 - ((factor - 1300) / 1700) * 9;
  return Math.min(10, Math.max(1, d));
}

/** Anki intervals are days, or negative seconds for (old-style) learning cards. */
export function ivlDays(ivl: number): number {
  return ivl < 0 ? -ivl / 86_400 : ivl;
}

export interface ScheduleContext {
  ankiToday: number;
  now: number;
  dayStartHour: number;
  /** Learning and relearning step counts of the card's options, to turn "steps left" into a step index. */
  learnSteps: number;
  relearnSteps: number;
}

export interface RevlogValues {
  id: number;
  rating: 0 | Rating;
  stateBefore: StateValue;
  dueBefore: number | null;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  durationMs: number;
  kind: RevlogKind;
}

export type MemorySource = 'fsrs' | 'replayed' | 'estimated' | 'new';

export interface Converted {
  card: Pick<
    Card,
    | 'state' | 'dueAt' | 'newPosition' | 'stability' | 'difficulty' | 'scheduledDays' | 'learningSteps' | 'reps'
    | 'lapses' | 'lastReviewAt' | 'suspended' | 'flag'
  >;
  revlog: RevlogValues[];
  memory: MemorySource;
  /** Replaying the history alone would have put the card due on a quite different day. */
  diverged: boolean;
}

const REPLAY_PRESET: PresetConfig = { ...DEFAULT_PRESET, enableFuzz: false };

function blankCard(): Card {
  return {
    id: 0, noteId: 0, ord: 0, deckId: 0, originalDeckId: null, state: 0, dueAt: null, newPosition: null, stability: 0,
    difficulty: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, lastReviewAt: null, suspended: false,
    buriedDay: null, buriedKind: null, flag: 0, createdAt: 0, updatedAt: 0,
  };
}

/** Anki revlog types; 5 ("rescheduled") arrived in newer versions and is a manual change too. */
function kindOf(type: number): RevlogKind {
  return type >= 0 && type <= 4 ? (type as RevlogKind) : 4;
}

/** Whether an entry is an actual answer that moves memory, rather than a manual change or a preview. */
function isAnswer(e: SRevlog): boolean {
  if (e.ease < 1 || e.ease > 4) return false;
  if (e.type === 4 || e.type > 4) return false;
  // Filtered-deck previews (no rescheduling) log ivl 0 and change nothing.
  if (e.type === 3 && e.ivl === 0) return false;
  return true;
}

/**
 * Replays a card's history through FSRS on a scratch card. Returns the values
 * for every revlog row (in id order) and the final scratch card.
 */
export function replay(history: SRevlog[]): { values: RevlogValues[]; final: Card; answered: number } {
  let card = blankCard();
  let answered = 0;
  const values: RevlogValues[] = [];
  for (const e of [...history].sort((a, b) => a.id - b.id)) {
    const base = {
      id: e.id,
      rating: (e.ease >= 1 && e.ease <= 4 ? e.ease : 0) as 0 | Rating,
      stateBefore: card.state,
      dueBefore: card.dueAt,
      scheduledDays: ivlDays(e.ivl),
      durationMs: Math.max(0, Math.round(e.timeMs)),
      kind: kindOf(e.type),
    };
    if (!isAnswer(e)) {
      // "Forget" logs a manual entry with interval 0 and makes the card new again.
      if (e.type === 4 && e.ivl === 0 && e.ease === 0) card = blankCard();
      values.push({ ...base, stability: card.stability, difficulty: card.difficulty, elapsedDays: 0 });
      continue;
    }
    const o = answerCard(card, e.id, e.ease as Rating, REPLAY_PRESET);
    values.push({ ...base, stability: o.log.stability, difficulty: o.log.difficulty, elapsedDays: o.log.elapsedDays });
    card = { ...card, ...o.card };
    answered++;
  }
  return { values, final: card, answered };
}

function stepIndex(left: number, total: number): number {
  if (total <= 0) return 0;
  // Older files pack "reviews left today" into the thousands; only the steps matter.
  const remaining = left % 1000;
  return Math.min(total - 1, Math.max(0, total - remaining));
}

export function convertCard(c: SCard, history: SRevlog[], ctx: ScheduleContext): Converted {
  const state = (c.type >= 0 && c.type <= 3 ? c.type : 0) as StateValue;
  // In a filtered deck `due` is a position in that deck; the real due date waits in `odue`.
  const due = c.origDeckId !== 0 ? c.odue : c.due;
  const { values, final, answered } = replay(history);
  const flag = c.flags & 7;
  const suspended = c.queue === -1;
  const reps = Math.max(0, c.reps);
  const lapses = Math.max(0, c.lapses);

  if (state === 0) {
    return {
      card: {
        state, dueAt: null, newPosition: due, stability: 0, difficulty: 0, scheduledDays: 0, learningSteps: 0, reps,
        lapses, lastReviewAt: null, suspended, flag,
      },
      revlog: values,
      memory: 'new',
      diverged: false,
    };
  }

  const exactTime = due > EPOCH_SECONDS_THRESHOLD;
  const dueAt = exactTime ? due * 1000 : dueAtForAnkiDay(due, ctx.ankiToday, ctx.now, ctx.dayStartHour);
  // Atlas treats a (re)learning card as same-day only while scheduledDays < 1.
  const scheduledDays = state === 2 ? Math.max(1, ivlDays(c.ivl)) : exactTime ? 0 : Math.max(1, ivlDays(c.ivl));
  const learningSteps =
    state === 1 ? stepIndex(c.left, ctx.learnSteps) : state === 3 ? stepIndex(c.left, ctx.relearnSteps) : 0;

  let memory: MemorySource;
  let stability: number;
  let difficulty: number;
  if (c.fsrsS !== null && c.fsrsD !== null && c.fsrsS > 0 && c.fsrsD > 0) {
    memory = 'fsrs';
    stability = c.fsrsS;
    difficulty = Math.min(10, Math.max(1, c.fsrsD));
  } else if (answered > 0 && final.state !== 0) {
    memory = 'replayed';
    stability = final.stability;
    difficulty = final.difficulty;
  } else {
    memory = 'estimated';
    stability = Math.max(1, ivlDays(c.ivl));
    difficulty = difficultyFromEase(c.factor);
  }

  const lastAnswer = [...history].filter(isAnswer).sort((a, b) => b.id - a.id)[0];
  const lastReviewAt = lastAnswer
    ? lastAnswer.id
    : c.dataLrt !== null && reps > 0
      ? c.dataLrt * 1000
      : state === 2
        ? dueAt - scheduledDays * DAY_MS
        : null;

  let diverged = false;
  if (memory === 'replayed' && state === 2 && final.dueAt !== null) {
    const gapDays = Math.abs(final.dueAt - dueAt) / DAY_MS;
    diverged = gapDays > Math.max(2, scheduledDays * 0.25);
  }

  return {
    card: {
      state, dueAt, newPosition: null, stability, difficulty, scheduledDays, learningSteps, reps, lapses, lastReviewAt,
      suspended, flag,
    },
    revlog: values,
    memory,
    diverged,
  };
}
