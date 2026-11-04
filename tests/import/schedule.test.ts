import { describe, expect, test } from 'vitest';
import { startOfStudyDay, studyDay } from '../../src/core/studyDay';
import {
  ankiToday, convertCard, difficultyFromEase, dueAtForAnkiDay, ivlDays, replay, type ScheduleContext,
} from '../../src/import/schedule';
import { noteChunks, readMeta, type SCard, type SRevlog, type StagingSource } from '../../src/import/staging';
import { DAY, T0 } from '../helpers/fixtures';
import { expected, staged } from './helpers';

/** The staged card (and its reviews) of the note whose first field is `front`. */
async function cardOf(src: StagingSource, front: string, ord = 0): Promise<{ card: SCard; reviews: SRevlog[] }> {
  for await (const chunk of noteChunks(src, 1000)) {
    const note = chunk.notes.find((n) => n.fields[0] === front);
    if (!note) continue;
    const card = chunk.cards.find((c) => c.noteId === note.id && c.ord === ord)!;
    return { card, reviews: chunk.revlog.filter((r) => r.cardId === card.id) };
  }
  throw new Error(`no note ${front}`);
}

async function richContext(): Promise<ScheduleContext> {
  const src = staged('rich-modern');
  const meta = await readMeta(src);
  const exp = await expected('rich-modern');
  const now = exp.generated.now_ms;
  return {
    ankiToday: ankiToday({ crtSecs: meta.ankiCrt, rolloverHour: meta.ankiRolloverHour, creationOffsetMin: meta.ankiCreationOffset }, now),
    now, dayStartHour: 4, learnSteps: 2, relearnSteps: 1,
  };
}

/** Atlas's start of the study day `offset` days from `now`: where a card due `offset` days from Anki's today must land. */
const dayStart = (ctx: ScheduleContext, offset: number) => startOfStudyDay(studyDay(ctx.now, ctx.dayStartHour) + offset, ctx.dayStartHour);

describe("Anki's today", () => {
  test("matches the day number Anki itself reported when exporting each fixture", async () => {
    for (const name of ['rich-modern', 'fsrs-modern'] as const) {
      const meta = await readMeta(staged(name));
      const exp = await expected(name);
      expect(exp.generated.tz).toBe(process.env.TZ);
      const t = { crtSecs: meta.ankiCrt, rolloverHour: meta.ankiRolloverHour, creationOffsetMin: meta.ankiCreationOffset };
      expect(ankiToday(t, exp.generated.now_ms), name).toBe(exp.generated.anki_today);
    }
  });

  test('counts calendar days, not 24-hour periods, across a clock change', () => {
    // Created 10 Jan at 04:00 GMT; on 10 Jun at 04:30 BST it is 03:30 UTC, less
    // than 151 × 24 h later, but the rollover has passed on day 151.
    const t = { crtSecs: Date.UTC(2026, 0, 10, 4) / 1000, rolloverHour: 4, creationOffsetMin: 0 };
    const now = Date.UTC(2026, 5, 10, 3, 30);
    expect(Math.floor((now / 1000 - t.crtSecs) / 86_400)).toBe(150);
    expect(ankiToday(t, now)).toBe(151);
  });

  test('before the rollover hour it is still yesterday', () => {
    const t = { crtSecs: Date.UTC(2026, 0, 10, 4) / 1000, rolloverHour: 4, creationOffsetMin: null };
    expect(ankiToday(t, Date.UTC(2026, 0, 20, 3, 59))).toBe(9);
    expect(ankiToday(t, Date.UTC(2026, 0, 20, 4, 0))).toBe(10);
  });

  test("uses the creation offset Anki recorded, not today's", () => {
    // 23:30 UTC on 9 Jan was already 10 Jan for a collection made at UTC+1, which Anki stores as −60 (minutes west).
    const crtSecs = Date.UTC(2026, 0, 9, 23, 30) / 1000;
    expect(ankiToday({ crtSecs, rolloverHour: 0, creationOffsetMin: -60 }, Date.UTC(2026, 0, 20, 12))).toBe(10);
    expect(ankiToday({ crtSecs, rolloverHour: 0, creationOffsetMin: 0 }, Date.UTC(2026, 0, 20, 12))).toBe(11);
  });
});

describe('due dates', () => {
  test('a card N days from Anki\'s today is N days from Atlas\'s today, at the start of that day', () => {
    const today = 500;
    for (const offset of [0, 1, 5, -1, -12, 365]) {
      const at = dueAtForAnkiDay(today + offset, today, T0, 4);
      expect(studyDay(at, 4) - studyDay(T0, 4)).toBe(offset);
      expect(new Date(at).getHours()).toBe(4);
    }
  });

  test('across the October clock change the day still starts at 04:00 local time', () => {
    // T0 is 31 Oct 2026, after UK clocks went back; ten days earlier was BST.
    const before = dueAtForAnkiDay(90, 100, T0, 4);
    expect(new Date(before).toISOString()).toBe('2026-10-21T03:00:00.000Z');
    expect(new Date(dueAtForAnkiDay(100, 100, T0, 4)).toISOString()).toBe('2026-10-31T04:00:00.000Z');
  });

  test('property: never earlier or later than Anki by even one day, wherever "now" falls in the year', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 5000; i++) {
      const now = Date.UTC(2026, 0, 1) + Math.floor(rand() * 400 * DAY);
      const dayStartHour = Math.floor(rand() * 8);
      const today = 1000 + Math.floor(rand() * 3000);
      const offset = Math.floor(rand() * 4000) - 400;
      const at = dueAtForAnkiDay(today + offset, today, now, dayStartHour);
      expect(studyDay(at, dayStartHour) - studyDay(now, dayStartHour)).toBe(offset);
      if (offset > 0) expect(at).toBeGreaterThan(now);
    }
  });
});

describe('each kind of card, from the real package', () => {
  test('review, due in the future: same day as Anki; memory replayed from its history', async () => {
    const ctx = await richContext();
    const { card, reviews } = await cardOf(staged('rich-modern'), 'State card 01');
    const out = convertCard(card, reviews, ctx);
    expect(card).toMatchObject({ type: 2, queue: 2 });
    expect(out.card.state).toBe(2);
    expect(out.card.dueAt).toBe(dayStart(ctx, card.due - ctx.ankiToday));
    expect(out.card.scheduledDays).toBe(card.ivl);
    expect(out.memory).toBe('replayed');
    expect(out.card.stability).toBeGreaterThan(0);
    expect(out.card.lastReviewAt).toBe(Math.max(...reviews.map((r) => r.id)));
    expect(out.card.reps).toBe(card.reps);
  });

  test('review, overdue: stays overdue by the same number of days', async () => {
    const ctx = await richContext();
    const { card, reviews } = await cardOf(staged('rich-modern'), 'State card 04');
    expect(card.due).toBeLessThan(ctx.ankiToday);
    const out = convertCard(card, reviews, ctx);
    expect(studyDay(out.card.dueAt!, 4) - studyDay(ctx.now, 4)).toBe(card.due - ctx.ankiToday);
    expect(out.card.flag).toBe(1);
  });

  test('suspended review keeps its schedule and is suspended', async () => {
    const ctx = await richContext();
    const { card, reviews } = await cardOf(staged('rich-modern'), 'State card 03');
    const out = convertCard(card, reviews, ctx);
    expect(card.queue).toBe(-1);
    expect(out.card).toMatchObject({ state: 2, suspended: true, dueAt: dayStart(ctx, card.due - ctx.ankiToday) });
  });

  test('a card in a filtered deck is due when its original due date says', async () => {
    const ctx = await richContext();
    const { card, reviews } = await cardOf(staged('rich-modern'), 'State card 07');
    expect(card.due).toBeLessThan(0);
    expect(card.origDeckId).not.toBe(0);
    const out = convertCard(card, reviews, ctx);
    expect(out.card.dueAt).toBe(dayStart(ctx, card.odue - ctx.ankiToday));
    expect(out.card.lapses).toBe(1);
  });

  test('a new card in a filtered deck keeps its original queue position', async () => {
    const ctx = await richContext();
    const { card, reviews } = await cardOf(staged('rich-modern'), 'Formula of methane');
    const out = convertCard(card, reviews, ctx);
    expect(out.card).toMatchObject({ state: 0, dueAt: null, newPosition: card.odue });
  });

  test('learning: exact due time and the step it is on', async () => {
    const ctx = await richContext();
    const { card, reviews } = await cardOf(staged('rich-modern'), 'State card 09');
    expect(card).toMatchObject({ type: 1, queue: 1, left: 1 });
    const out = convertCard(card, reviews, ctx);
    expect(out.card).toMatchObject({ state: 1, dueAt: card.due * 1000, scheduledDays: 0, learningSteps: 1 });
  });

  test('relearning: exact due time, lapse kept', async () => {
    const ctx = await richContext();
    const { card, reviews } = await cardOf(staged('rich-modern'), 'State card 02');
    expect(card).toMatchObject({ type: 3, queue: 1 });
    const out = convertCard(card, reviews, ctx);
    expect(out.card).toMatchObject({ state: 3, dueAt: card.due * 1000, scheduledDays: 0, lapses: 1, learningSteps: 0 });
  });

  test('interday learning: due on a day, treated as an interday card', async () => {
    const ctx = await richContext();
    const { card, reviews } = await cardOf(staged('rich-modern'), 'Interday learner');
    expect(card).toMatchObject({ type: 1, queue: 3 });
    const out = convertCard(card, reviews, ctx);
    expect(out.card.dueAt).toBe(dayStart(ctx, card.due - ctx.ankiToday));
    expect(out.card.scheduledDays).toBeGreaterThanOrEqual(1);
    expect(out.card.state).toBe(1);
  });

  test('"forgotten": new again, keeps its reps and every review', async () => {
    const ctx = await richContext();
    const { card, reviews } = await cardOf(staged('rich-modern'), 'State card 14');
    const out = convertCard(card, reviews, ctx);
    expect(out.card).toMatchObject({ state: 0, dueAt: null, reps: card.reps, stability: 0, lastReviewAt: null });
    expect(out.memory).toBe('new');
    expect(out.revlog).toHaveLength(reviews.length);
    expect(out.revlog.at(-1)).toMatchObject({ rating: 0, kind: 4 });
  });

  test('FSRS memory stored by Anki is used as it is', async () => {
    const { card, reviews } = await cardOf(staged('fsrs-modern'), 'Ion 1');
    const ctx = { ...(await richContext()), now: (await expected('fsrs-modern')).generated.now_ms };
    const out = convertCard(card, reviews, ctx);
    expect(out.memory).toBe('fsrs');
    expect(out.card.stability).toBe(card.fsrsS);
    expect(out.card.difficulty).toBe(card.fsrsD);
  });

  test('every card of the no-scheduling export is new with no history', async () => {
    const ctx = await richContext();
    for await (const chunk of noteChunks(staged('rich-modern-nosched'), 1000)) {
      expect(chunk.revlog).toEqual([]);
      for (const c of chunk.cards) expect(convertCard(c, [], ctx).memory).toBe('new');
    }
  });
});

describe('cards with little to go on', () => {
  const ctx: ScheduleContext = { ankiToday: 100, now: T0, dayStartHour: 4, learnSteps: 3, relearnSteps: 1 };
  const base: SCard = {
    id: 1, noteId: 1, deckId: 1, origDeckId: 0, ord: 0, type: 2, queue: 2, due: 110, ivl: 30, factor: 2500, reps: 5,
    lapses: 0, left: 0, odue: 0, flags: 0, fsrsS: null, fsrsD: null, dataLrt: null,
  };

  test('a review card with no history gets an estimate from its interval and ease', () => {
    const out = convertCard(base, [], ctx);
    expect(out.memory).toBe('estimated');
    expect(out.card.stability).toBe(30);
    expect(out.card.difficulty).toBeCloseTo(10 - (1200 / 1700) * 9, 10);
    // Last review assumed one interval before the due date.
    expect(out.card.lastReviewAt).toBe(out.card.dueAt! - 30 * DAY);
  });

  test("Anki's own last-review time is used when there's no history", () => {
    const out = convertCard({ ...base, dataLrt: 1_790_000_000 }, [], ctx);
    expect(out.card.lastReviewAt).toBe(1_790_000_000_000);
  });

  test('older files pack "left today" into the thousands; only the steps count', () => {
    const out = convertCard({ ...base, type: 1, queue: 1, due: 1_800_000_000, left: 2003, ivl: 0 }, [], ctx);
    expect(out.card.learningSteps).toBe(0);
    expect(convertCard({ ...base, type: 1, queue: 1, due: 1_800_000_000, left: 1, ivl: 0 }, [], ctx).card.learningSteps).toBe(2);
  });

  test('a suspended learning card still knows whether its due is a time or a day', () => {
    const timed = convertCard({ ...base, type: 1, queue: -1, due: 1_800_000_000, ivl: 0, left: 1 }, [], ctx);
    expect(timed.card.dueAt).toBe(1_800_000_000_000);
    const daily = convertCard({ ...base, type: 1, queue: -1, due: 103, ivl: 0, left: 1 }, [], ctx);
    expect(studyDay(daily.card.dueAt!, 4) - studyDay(T0, 4)).toBe(3);
  });

  test('ease maps to difficulty: harder ease, higher difficulty, within 1–10', () => {
    expect(difficultyFromEase(1300)).toBe(10);
    expect(difficultyFromEase(3000)).toBe(1);
    expect(difficultyFromEase(5000)).toBe(1);
    expect(difficultyFromEase(0)).toBe(5);
    for (let f = 1300; f < 3000; f += 50) expect(difficultyFromEase(f + 50)).toBeLessThan(difficultyFromEase(f));
  });

  test('negative Anki intervals are seconds', () => {
    expect(ivlDays(-43_200)).toBe(0.5);
    expect(ivlDays(7)).toBe(7);
  });
});

describe('replaying history', () => {
  const r = (day: number, ease: number, type = 1, ivl = 1): SRevlog => ({
    id: T0 + day * DAY, cardId: 1, ease, ivl, lastIvl: 0, factor: 2500, timeMs: 4000, type,
  });

  test('successful reviews raise stability; each row records the state before it', () => {
    const { values, final } = replay([r(0, 3, 0, 0), r(1, 3, 0, 1), r(4, 3), r(12, 3)]);
    const s = values.map((v) => v.stability);
    expect(s[3]!).toBeGreaterThan(s[2]!);
    expect(values[0]!.stateBefore).toBe(0);
    expect(values[3]!.stateBefore).toBe(2);
    expect(final.state).toBe(2);
  });

  test('manual entries change nothing, except "Forget", which starts again', () => {
    const { values } = replay([r(0, 3, 0, 0), r(1, 3, 0, 1), r(5, 0, 4, 30), r(6, 0, 4, 0)]);
    expect(values[2]!.stability).toBe(values[1]!.stability);
    expect(values[3]!.stability).toBe(0);
    expect(values.map((v) => v.kind)).toEqual([0, 0, 4, 4]);
  });

  test('replay never moves an imported due date', async () => {
    const ctx = await richContext();
    const { card, reviews } = await cardOf(staged('rich-modern'), 'State card 08');
    const anki = dayStart(ctx, card.due - ctx.ankiToday);
    expect(convertCard(card, reviews, ctx).card.dueAt).toBe(anki);
  });
});
