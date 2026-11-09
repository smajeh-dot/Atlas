// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { Db } from '../../../src/data/db';
import { UndoStack } from '../../../src/services/undo';
import { DAY, fixedClock, T0 } from '../../helpers/fixtures';
import { renderApp } from '../../helpers/renderApp';
import { seedDeck, seedNote } from '../../helpers/seed';
import { createMigratedDb } from '../../helpers/testDb';

vi.mock('../../../src/ui/editor/FieldEditor', () => import('../../helpers/fieldEditorStub'));

async function withCard(): Promise<{ db: Db; cardId: number }> {
  const db = await createMigratedDb();
  const deck = await seedDeck(db, 'Biology');
  const { cardIds } = await seedNote({ db, clock: fixedClock(T0), undo: new UndoStack() }, deck, 'basic', ['front', 'back']);
  return { db, cardId: cardIds[0]! };
}

const answer = (db: Db, cardId: number, t: number) =>
  db.execute(
    `INSERT INTO revlog (id, card_id, rating, state_before, due_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, kind)
     VALUES (?, ?, 3, 2, NULL, 5, 5, 1, 1, 6000, 1)`,
    [t, cardId],
  );

async function heatmap() {
  const activity = await screen.findByTestId('today-activity');
  const map = within(activity).getByRole('img', { name: 'Reviews per day over the last year' });
  return { activity, map, cells: () => [...map.querySelectorAll<HTMLElement>('[data-level]')] };
}

test('with no study history the heatmap is empty: nothing is shaded, so no made-up streak', async () => {
  const { db } = await withCard();
  await renderApp({ db });
  const { cells } = await heatmap();
  expect(cells().length).toBeGreaterThan(300);
  expect(cells().every((c) => c.dataset.level === '0')).toBe(true);
});

test('days you studied are shaded, and hovering one shows its real count', async () => {
  const { db, cardId } = await withCard();
  for (let i = 0; i < 3; i++) await answer(db, cardId, T0 - DAY + i * 1000); // Friday 30 October
  await answer(db, cardId, T0 - 3 * DAY); // Wednesday 28 October
  const { user } = await renderApp({ db });
  const { cells } = await heatmap();
  await vi.waitFor(() => expect(cells().filter((c) => c.dataset.level !== '0')).toHaveLength(2));

  const busiest = cells().find((c) => c.dataset.level === '4')!;
  await user.hover(busiest);
  expect((await screen.findByRole('tooltip')).textContent).toBe('Fri 30 Oct · 3 reviews');
});
