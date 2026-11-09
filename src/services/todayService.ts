import { bannerText, estimateMinutes, heatLevels, heatmapGrid, streakDays, type HeatLevel } from '../core/todayStats';
import { startOfStudyDay, studyDay } from '../core/studyDay';
import type { Db } from '../data/db';
import { getSettings } from '../data/settings';
import { planStudy } from './deckService';

export type HeatCell = { day: number; count: number; level: HeatLevel; label: string } | null;

export interface TodaySummary {
  /** e.g. "SATURDAY 31 OCTOBER" */
  dateLabel: string;
  due: number;
  newCount: number;
  title: string;
  sub: string;
  allDone: boolean;
  streak: number;
  /** Share of review-card answers in the last 30 days that weren't Again; null with no such answers. */
  retention30: number | null;
  /** 12 columns (oldest first) of 7 rows (Monday first). */
  heatmap: HeatCell[][];
  forecast: { label: string; count: number; today: boolean }[];
}

// Half-hour buckets keep the query small (one row per half-hour studied) while still
// lining up with local study-day boundaries in every time zone with whole or half-hour offsets.
const BUCKET_MS = 1_800_000;
const LOOKAHEAD_DAYS = 365;

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', opts);
const weekdayShort = fmt({ weekday: 'short' });
const cellDate = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const longDate = fmt({ weekday: 'long', day: 'numeric', month: 'long' });

/**
 * Answers per study day, from `from` up to (not including) `to`. Only real answers count: manual schedule
 * entries are logged with rating 0 and are left out.
 */
async function reviewsPerDay(db: Db, dayStartHour: number, to: number, from = 0): Promise<Map<number, number>> {
  const perDay = new Map<number, number>();
  const buckets = await db.query<{ b: number; n: number }>(
    `SELECT id / ${BUCKET_MS} AS b, COUNT(*) AS n FROM revlog WHERE rating > 0 AND id >= ? AND id < ? GROUP BY b`, [from, to]);
  for (const { b, n } of buckets) {
    const d = studyDay(Number(b) * BUCKET_MS, dayStartHour);
    perDay.set(d, (perDay.get(d) ?? 0) + Number(n));
  }
  return perDay;
}

/** The heatmap grid for `weeks` weeks ending with the week of `today` (the 12-week default is the grid's own), shaded by how busy each day was. */
export function buildHeatmap(perDay: Map<number, number>, today: number, dayStartHour: number, weeks?: number): HeatCell[][] {
  const dayStart = (d: number) => startOfStudyDay(d, dayStartHour);
  const weekday = (new Date(dayStart(today)).getDay() + 6) % 7;
  const grid = heatmapGrid(today, weekday, weeks);
  const visible = grid.flat().filter((d): d is number => d !== null);
  const visibleLevels = heatLevels(visible.map((d) => perDay.get(d) ?? 0));
  const levels = new Map(visible.map((d, i) => [d, visibleLevels[i]!]));
  return grid.map((col) =>
    col.map((day) => {
      if (day === null) return null;
      const count = perDay.get(day) ?? 0;
      return { day, count, level: levels.get(day) ?? 0, label: `${cellDate.format(dayStart(day)).replace(',', '')} · ${count} ${count === 1 ? 'review' : 'reviews'}` };
    }),
  );
}

/** Weeks shown by the Home heatmap: a year. */
export const HEATMAP_WEEKS = 53;

/** Your real study history as a heatmap grid: columns are weeks (oldest first), rows Monday to Sunday, the last column being this week. */
export async function getHeatmap(db: Db, now: number, weeks = HEATMAP_WEEKS): Promise<HeatCell[][]> {
  const { dayStartHour } = await getSettings(db);
  const today = studyDay(now, dayStartHour);
  // Starting a little before the first column is harmless: days outside the grid are never read.
  const perDay = await reviewsPerDay(db, dayStartHour, startOfStudyDay(today + 1, dayStartHour), startOfStudyDay(today - weeks * 7, dayStartHour));
  return buildHeatmap(perDay, today, dayStartHour, weeks);
}

export async function getTodaySummary(db: Db, now: number): Promise<TodaySummary> {
  const { dayStartHour } = await getSettings(db);
  const today = studyDay(now, dayStartHour);
  const dayStart = (d: number) => startOfStudyDay(d, dayStartHour);
  const rollover = dayStart(today + 1);

  const plan = await planStudy(db, null, now);
  const due = plan.reviewCards.length + plan.learning.length + plan.interdayLearning.length;
  const newCount = plan.newCards.length;

  const windowStart = dayStart(today - 29);
  const [avg] = await db.query<{ ms: number | null }>(
    `SELECT AVG(duration_ms) AS ms FROM revlog WHERE rating > 0 AND id >= ? AND id < ?`, [windowStart, rollover]);
  const [ret] = await db.query<{ n: number; kept: number | null }>(
    `SELECT COUNT(*) AS n, SUM(rating > 1) AS kept FROM revlog WHERE rating > 0 AND state_before = 2 AND id >= ? AND id < ?`,
    [windowStart, rollover]);

  const perDay = await reviewsPerDay(db, dayStartHour, rollover);
  const heatmap = buildHeatmap(perDay, today, dayStartHour);

  const upcoming = await db.query<{ due_at: number }>(
    `SELECT due_at FROM cards WHERE suspended = 0 AND state IN (1, 2, 3) AND due_at >= ? AND due_at < ?`,
    [rollover, dayStart(today + 7)]);
  const counts = Array.from({ length: 7 }, () => 0);
  counts[0] = due;
  for (const { due_at } of upcoming) {
    const i = studyDay(Number(due_at), dayStartHour) - today;
    if (i >= 1 && i <= 6) counts[i]!++;
  }
  const forecast = counts.map((count, i) => ({ label: weekdayShort.format(dayStart(today + i)), count, today: i === 0 }));

  let next: { inDays: number; count: number } | null = null;
  const [first] = await db.query<{ t: number | null }>(
    `SELECT MIN(due_at) AS t FROM cards WHERE suspended = 0 AND state IN (1, 2, 3) AND due_at >= ? AND due_at < ?`,
    [rollover, dayStart(today + LOOKAHEAD_DAYS)]);
  if (first?.t !== null && first?.t !== undefined) {
    const d = studyDay(Number(first.t), dayStartHour);
    const [c] = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM cards WHERE suspended = 0 AND state IN (1, 2, 3) AND due_at >= ? AND due_at < ?`,
      [dayStart(d), dayStart(d + 1)]);
    next = { inDays: d - today, count: Number(c?.n ?? 0) };
  }

  const minutes = estimateMinutes(due + newCount, avg?.ms === null || avg?.ms === undefined ? null : Number(avg.ms));
  const n = Number(ret?.n ?? 0);
  return {
    dateLabel: longDate.format(dayStart(today)).replace(',', '').toUpperCase(),
    due,
    newCount,
    ...bannerText({ due, newCount, minutes, next }),
    allDone: due + newCount === 0,
    streak: streakDays([...perDay.keys()], today),
    retention30: n ? Number(ret?.kept ?? 0) / n : null,
    heatmap,
    forecast,
  };
}
