import { beforeEach, expect, test } from 'vitest';
import type { Db } from '../../src/data/db';
import { getHeatmap } from '../../src/services/todayService';
import { UndoStack } from '../../src/services/undo';
import { createMigratedDb } from '../helpers/testDb';
import { DAY, fixedClock, T0 } from '../helpers/fixtures';
import { seedDeck, seedNote } from '../helpers/seed';

// T0 is Saturday 31 October 2026, 09:00 (UK time; the clocks went back on 25 October). Days start at 04:00 by default.
const HOUR = 3_600_000;

let db: Db;
let cardId: number;
let nextId = 0;
beforeEach(async () => {
  db = await createMigratedDb();
  const deck = await seedDeck(db, 'Biology');
  const deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  cardId = (await seedNote(deps, deck, 'basic', ['front', 'back'])).cardIds[0]!;
  nextId = 0;
});

/** One logged answer at time `t` (revlog ids are answer times). `rating` 0 is a manual entry, not an answer. */
function answer(t: number, rating = 3) {
  return db.execute(
    `INSERT INTO revlog (id, card_id, rating, state_before, due_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, kind)
     VALUES (?, ?, ?, 2, NULL, 5, 5, 1, 1, 6000, ?)`,
    [t + nextId++, cardId, rating, rating === 0 ? 4 : 1],
  );
}

const cells = (grid: Awaited<ReturnType<typeof getHeatmap>>) => grid.flat().filter((c) => c !== null);

test('a year of 53 weeks, Monday at the top, today in the last column and the days after it empty', async () => {
  const grid = await getHeatmap(db, T0);
  expect(grid).toHaveLength(53);
  expect(grid.every((col) => col.length === 7)).toBe(true);
  expect(grid[52]![5]).toMatchObject({ count: 0, label: 'Sat 31 Oct · 0 reviews' });
  expect(grid[52]![6]).toBeNull();
  expect(grid[0]![0]!.label).toBe('Mon 27 Oct · 0 reviews'); // 52 weeks before this week's Monday (26 Oct 2026)
});

test('counts the real answers on each day, with the right wording', async () => {
  await answer(T0);
  await answer(T0 + 1000);
  for (let i = 0; i < 3; i++) await answer(T0 - DAY + i * 1000);
  await answer(T0 - 10 * DAY);
  const grid = await getHeatmap(db, T0);
  expect(grid[52]![5]).toMatchObject({ count: 2, label: 'Sat 31 Oct · 2 reviews' });
  expect(grid[52]![4]).toMatchObject({ count: 3, label: 'Fri 30 Oct · 3 reviews' });
  expect(grid[51]![2]).toMatchObject({ count: 1, label: 'Wed 21 Oct · 1 review' }); // T0 - 10 days, in the previous week
  expect(cells(grid).reduce((n, c) => n + c.count, 0)).toBe(2 + 3 + 1);
});

test('days with answers are shaded, the busiest darkest, and days without stay level 0', async () => {
  await answer(T0);
  await answer(T0 + 1000);
  for (let i = 0; i < 3; i++) await answer(T0 - DAY + i * 1000);
  const grid = await getHeatmap(db, T0);
  expect(grid[52]![4]!.level).toBe(4);
  expect(grid[52]![5]!.level).toBeGreaterThan(0);
  expect(grid[52]![3]!.level).toBe(0);
});

test('a day runs from the "next day starts at" hour: an answer at 01:30 belongs to the day before', async () => {
  const sunday = T0 + 27 * HOUR; // Sunday 1 November, 12:00
  await answer(Date.UTC(2026, 10, 1, 1, 30)); // still Saturday's study day
  await answer(Date.UTC(2026, 10, 1, 4, 30)); // Sunday's
  await answer(Date.UTC(2026, 10, 1, 5, 30));
  const grid = await getHeatmap(db, sunday);
  expect(grid[52]![5]).toMatchObject({ count: 1, label: 'Sat 31 Oct · 1 review' });
  expect(grid[52]![6]).toMatchObject({ count: 2, label: 'Sun 1 Nov · 2 reviews' });
});

test('manual schedule entries are not counted as reviews', async () => {
  await answer(T0, 0);
  await answer(T0 + 1000, 0);
  await answer(T0 + 2000, 3);
  const grid = await getHeatmap(db, T0);
  expect(grid[52]![5]!.count).toBe(1);
});

test('answers from before the year shown are left out', async () => {
  await answer(T0 - 400 * DAY);
  await answer(T0 - 5 * DAY);
  expect(cells(await getHeatmap(db, T0)).reduce((n, c) => n + c.count, 0)).toBe(1);
});

test('with no history every day is empty: no counts, no shading', async () => {
  const all = cells(await getHeatmap(db, T0));
  expect(all.length).toBeGreaterThan(300);
  expect(all.every((c) => c.count === 0 && c.level === 0)).toBe(true);
});
