import { heatLevels, heatmapGrid } from '../core/todayStats';
import type { HeatCell } from '../services/todayService';

/** Made-up review counts for the Today heatmap, until it reads your real history. Same shape as the real thing. */
const DAY_MS = 86_400_000;
const label = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** Small seeded random numbers, so the mock looks the same on every launch. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mockHeatmap(now: number): HeatCell[][] {
  const today = Math.floor(now / DAY_MS);
  const weekday = (new Date(now).getUTCDay() + 6) % 7; // 0 = Monday
  const days = heatmapGrid(today, weekday);
  const rand = seeded(7);
  // Busier on weekdays, some days off, and the last few days all studied so there's a streak.
  const countFor = (day: number, r: number) => {
    const recent = today - day < 5;
    const weekend = (day - (today - weekday) + 7) % 7 >= 5;
    if (!recent && r < (weekend ? 0.45 : 0.15)) return 0;
    return Math.round((weekend ? 10 : 25) + rand() * (weekend ? 30 : 70));
  };
  const counts = days.map((col) => col.map((day) => (day === null ? null : countFor(day, rand()))));
  const levels = heatLevels(counts.flat().filter((c): c is number => c !== null));
  let i = 0;
  return counts.map((col, c) =>
    col.map((count, r): HeatCell => {
      if (count === null) return null;
      const day = days[c]![r]!;
      return { day, count, level: levels[i++]!, label: `${label.format(day * DAY_MS).replace(',', '')} · ${count} ${count === 1 ? 'review' : 'reviews'}` };
    }),
  );
}
