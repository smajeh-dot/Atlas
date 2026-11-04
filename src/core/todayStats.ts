/** Numbers and wording for the Today screen. Pure: every input is passed in. */

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

const WEEKS = 12;
const DEFAULT_ANSWER_MS = 10_000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Consecutive study days with at least one answer, ending today or yesterday. */
export function streakDays(daysWithReviews: number[], today: number): number {
  const days = new Set(daysWithReviews);
  let d = days.has(today) ? today : today - 1;
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
}

/** 0 for no reviews; otherwise 1–4 by quartile of the non-zero counts. */
export function heatLevels(counts: number[]): HeatLevel[] {
  const sorted = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (!sorted.length) return counts.map(() => 0);
  const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))]!;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  return counts.map((c) => (c <= 0 ? 0 : c <= q1 ? 1 : c <= q2 ? 2 : c <= q3 ? 3 : 4));
}

/**
 * Study-day numbers for the 12-week heatmap: columns oldest first, rows Monday (0) to Sunday (6).
 * `todayWeekday` is 0 for Monday. Days after today are null.
 */
export function heatmapGrid(today: number, todayWeekday: number, weeks = WEEKS): (number | null)[][] {
  const monday = today - todayWeekday;
  return Array.from({ length: weeks }, (_, c) =>
    Array.from({ length: 7 }, (_, r) => {
      const day = monday - (weeks - 1 - c) * 7 + r;
      return day > today ? null : day;
    }),
  );
}

export function estimateMinutes(cards: number, averageMs: number | null): number {
  return Math.ceil((cards * (averageMs ?? DEFAULT_ANSWER_MS)) / 60_000);
}

export function bannerText(s: {
  due: number;
  newCount: number;
  minutes: number;
  next: { inDays: number; count: number } | null;
}): { title: string; sub: string } {
  const minutes = `About ${plural(s.minutes, 'minute', 'minutes')}`;
  const ready = `${plural(s.newCount, 'new card', 'new cards')} ready`;
  if (s.due > 0) {
    return { title: `${plural(s.due, 'card', 'cards')} due today`, sub: s.newCount > 0 ? `${minutes} · ${ready}` : minutes };
  }
  if (s.newCount > 0) return { title: `Reviews done · ${ready}`, sub: minutes };
  if (!s.next) return { title: 'All done for today', sub: 'No reviews scheduled yet' };
  const when = s.next.inDays === 1 ? 'tomorrow' : `in ${s.next.inDays} days`;
  return { title: 'All done for today', sub: `Next reviews: ${when}, ${plural(s.next.count, 'card', 'cards')}` };
}
