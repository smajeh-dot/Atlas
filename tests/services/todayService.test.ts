import { beforeEach, expect, test } from 'vitest';
import type { Db } from '../../src/data/db';
import { getTodaySummary } from '../../src/services/todayService';
import { UndoStack } from '../../src/services/undo';
import { createMigratedDb } from '../helpers/testDb';
import { DAY, fixedClock, T0 } from '../helpers/fixtures';
import { makeReview, seedDeck, seedNote } from '../helpers/seed';

let db: Db;
let deps: { db: Db; clock: ReturnType<typeof fixedClock>; undo: UndoStack };
let deck: number;
const HOUR = 3_600_000;

beforeEach(async () => {
  db = await createMigratedDb();
  deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  deck = await seedDeck(db, 'Biology');
});

async function card(front: string): Promise<number> {
  return (await seedNote(deps, deck, 'basic', [front, 'x'])).cardIds[0]!;
}

function answer(id: number, cardId: number, rating: number, stateBefore = 2) {
  return db.execute(
    `INSERT INTO revlog (id, card_id, rating, state_before, due_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, kind)
     VALUES (?, ?, ?, ?, NULL, 5, 5, 1, 1, 6000, 1)`,
    [id, cardId, rating, stateBefore],
  );
}

test('summary on a seeded collection', async () => {
  for (const f of ['r1', 'r2', 'r3']) await makeReview(db, await card(f), { dueAt: T0 - DAY });
  await card('n1');
  await card('n2');
  const tomorrow = await card('later');
  await makeReview(db, tomorrow, { dueAt: T0 + DAY });
  await answer(T0 - DAY, tomorrow, 3);
  await answer(T0 - DAY + 1000, tomorrow, 1);
  await answer(T0 - 2 * HOUR, tomorrow, 3);
  await answer(T0 - 2 * HOUR + 1000, tomorrow, 4);
  const s = await getTodaySummary(db, T0);
  expect(s.dateLabel).toBe('SATURDAY 31 OCTOBER');
  expect([s.due, s.newCount, s.streak, s.retention30]).toEqual([3, 2, 2, 0.75]);
  expect(s.title).toBe('3 cards due today');
  expect(s.sub).toBe('About 1 minute · 2 new cards ready');
  expect(s.allDone).toBe(false);
  expect(s.forecast.map((f) => f.count)).toEqual([3, 1, 0, 0, 0, 0, 0]);
  expect(s.forecast.map((f) => f.label)).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  expect(s.forecast[0]!.today).toBe(true);
  const todayCell = s.heatmap[11]![5]!;
  expect(todayCell).toMatchObject({ count: 2, label: 'Sat 31 Oct · 2 reviews' });
  expect(s.heatmap[11]![6]).toBeNull();
  expect(s.heatmap[11]![4]!.label).toBe('Fri 30 Oct · 2 reviews');
});

test('all done shows the next reviews', async () => {
  await makeReview(db, await card('later'), { dueAt: T0 + 3 * DAY });
  const s = await getTodaySummary(db, T0);
  expect(s.allDone).toBe(true);
  expect(s.title).toBe('All done for today');
  expect(s.sub).toBe('Next reviews: in 3 days, 1 card');
  expect(s.retention30).toBeNull();
  expect(s.streak).toBe(0);
});

test('studying at 01:30 counts as the previous day', async () => {
  const s = await getTodaySummary(db, Date.UTC(2026, 10, 1, 1, 30));
  expect(s.dateLabel).toBe('SATURDAY 31 OCTOBER');
});
