// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Db } from '../../../src/data/db';
import { listDecks } from '../../../src/data/decks';
import { UndoStack } from '../../../src/services/undo';
import { createMigratedDb } from '../../helpers/testDb';
import { DAY, fixedClock, T0 } from '../../helpers/fixtures';
import { makeReview, seedDeck, seedNote } from '../../helpers/seed';
import { renderApp } from '../../helpers/renderApp';

const HOUR = 3_600_000;
let db: Db;
let deps: { db: Db; clock: ReturnType<typeof fixedClock>; undo: UndoStack };

afterEach(() => vi.useRealTimers());

beforeEach(async () => {
  db = await createMigratedDb();
  deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
});

async function review(deck: number, front: string, dueAt = T0 - DAY) {
  const id = (await seedNote(deps, deck, 'basic', [front, 'x'])).cardIds[0]!;
  await makeReview(db, id, { dueAt });
  return id;
}

function answerAt(id: number, cardId: number) {
  return db.execute(
    `INSERT INTO revlog (id, card_id, rating, state_before, due_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, kind)
     VALUES (?, ?, 3, 2, NULL, 5, 5, 1, 1, 6000, 1)`, [id, cardId]);
}

test('banner shows the due count and Space starts studying all decks', async () => {
  const bio = await seedDeck(db, 'Biology');
  for (const f of ['a', 'b', 'c']) await review(bio, f);
  const { user } = await renderApp({ db });
  expect(await screen.findByRole('heading', { name: '3 cards due today' })).toBeTruthy();
  expect(screen.getByText('SATURDAY 31 OCTOBER')).toBeTruthy();
  expect(screen.getByText('About 1 minute')).toBeTruthy();
  await user.keyboard(' ');
  expect(await screen.findByRole('button', { name: 'Leave study' })).toBeTruthy();
});

test('all done hides Start studying', async () => {
  const bio = await seedDeck(db, 'Biology');
  await review(bio, 'later', T0 + 2 * DAY);
  await renderApp({ db });
  expect(await screen.findByRole('heading', { name: 'All done for today' })).toBeTruthy();
  expect(screen.getByText('Next reviews: in 2 days, 1 card')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Start studying' })).toBeNull();
});

test('arrow keys select rows, Enter studies the selected deck, ← collapses and is saved', async () => {
  const bio = await seedDeck(db, 'Biology');
  await seedDeck(db, 'Cells', bio);
  await seedDeck(db, 'Chemistry');
  const { user } = await renderApp({ db });
  const tree = await screen.findByRole('tree', { name: 'Decks' });
  await waitFor(() => expect(within(tree).getAllByRole('treeitem')).toHaveLength(3));
  await user.keyboard('{ArrowDown}');
  expect(within(tree).getByRole('treeitem', { selected: true }).textContent).toContain('Biology');
  await user.keyboard('{ArrowLeft}');
  await waitFor(() => expect(within(tree).getAllByRole('treeitem')).toHaveLength(2));
  expect((await listDecks(db)).find((d) => d.id === bio)!.collapsed).toBe(true);
  await user.keyboard('{ArrowDown}');
  expect(within(tree).getByRole('treeitem', { selected: true }).textContent).toContain('Chemistry');
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('button', { name: 'Leave study' })).toBeTruthy();
});

test('deck names are text, never markup', async () => {
  await seedDeck(db, '<img src=x onerror=alert(1)>');
  await renderApp({ db });
  const tree = await screen.findByRole('tree', { name: 'Decks' });
  expect(await within(tree).findByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(tree.querySelector('img')).toBeNull();
});

test('Delete asks with counts and removes the deck', async () => {
  const chem = await seedDeck(db, 'Chemistry');
  const org = await seedDeck(db, 'Organic', chem);
  await seedNote(deps, chem, 'basic', ['a', 'x']);
  await seedNote(deps, org, 'basic', ['b', 'x']);
  await seedDeck(db, 'Biology');
  const { user } = await renderApp({ db });
  const tree = await screen.findByRole('tree', { name: 'Decks' });
  const row = await within(tree).findByRole('treeitem', { name: /^Chemistry/ });
  await user.click(within(row).getByRole('button', { name: 'More options' }));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete Chemistry?' });
  expect(dialog.textContent).toContain("Delete Chemistry and its 1 subdeck? This deletes 2 cards and their review history. This can't be undone.");
  await user.click(within(dialog).getByRole('button', { name: 'Delete deck' }));
  await waitFor(() => expect(within(tree).queryByRole('treeitem', { name: /^Chemistry/ })).toBeNull());
  expect((await listDecks(db)).map((d) => d.name)).toEqual(['Biology']);
});

test('Rename shows the duplicate-name error inline and keeps the dialog open', async () => {
  await seedDeck(db, 'Chemistry');
  await seedDeck(db, 'Biology');
  const { user } = await renderApp({ db });
  const row = await within(await screen.findByRole('tree', { name: 'Decks' })).findByRole('treeitem', { name: /^Chemistry/ });
  fireEvent.contextMenu(row);
  await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
  const input = screen.getByLabelText('Deck name');
  await user.clear(input);
  await user.type(input, 'biology{Enter}');
  expect((await screen.findByRole('alert')).textContent).toBe('There is already a deck called "biology" here.');
  await user.clear(input);
  await user.type(input, 'Chem{Enter}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await listDecks(db)).map((d) => d.name).sort()).toEqual(['Biology', 'Chem']);
});

test('Add subdeck and Colour from the menu', async () => {
  const chem = await seedDeck(db, 'Chemistry');
  const { user } = await renderApp({ db });
  const row = await within(await screen.findByRole('tree', { name: 'Decks' })).findByRole('treeitem', { name: /^Chemistry/ });
  await user.click(within(row).getByRole('button', { name: 'More options' }));
  await user.click(screen.getByRole('menuitem', { name: 'Add subdeck' }));
  await user.type(screen.getByLabelText('Deck name'), 'Organic{Enter}');
  await waitFor(async () => expect((await listDecks(db)).find((d) => d.name === 'Organic')?.parentId).toBe(chem));
  await user.click(within(row).getByRole('button', { name: 'More options' }));
  await user.click(screen.getByRole('menuitem', { name: 'Colour' }));
  await user.click(screen.getByRole('menuitem', { name: 'Purple' }));
  await waitFor(async () => expect((await listDecks(db)).find((d) => d.id === chem)!.colour).toBe(5));
});

test('streak, retention and forecast boxes', async () => {
  const bio = await seedDeck(db, 'Biology');
  const c = await review(bio, 'a');
  await review(bio, 'b', T0 + DAY);
  await answerAt(T0 - DAY, c);
  await answerAt(T0 - HOUR, c);
  await renderApp({ db });
  expect(await screen.findByText('2 days')).toBeTruthy();
  expect(screen.getByText('Retention, last 30 days · 100%')).toBeTruthy();
  const forecast = screen.getByRole('list', { name: 'Due in the next 7 days' });
  const bars = within(forecast).getAllByRole('listitem');
  expect(bars).toHaveLength(7);
  expect(bars[0]!.getAttribute('data-highlight')).toBe('true');
  expect(bars[0]!.textContent).toBe('1Sat');
  expect(bars[1]!.textContent).toBe('1Sun');
});

test('Today recomputes after the day rolls over when the window regains focus', async () => {
  const bio = await seedDeck(db, 'Biology');
  await review(bio, 'a', T0 + 25 * HOUR);
  const clock = fixedClock(T0 + 14 * HOUR);
  await renderApp({ db, clock });
  expect(await screen.findByRole('heading', { name: 'All done for today' })).toBeTruthy();
  clock.advance(10 * HOUR);
  act(() => void window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('heading', { name: '1 card due today' })).toBeTruthy();
  expect(screen.getByText('SUNDAY 1 NOVEMBER')).toBeTruthy();
});

test('Today catches up with a new study day by itself, without the window being refocused', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const bio = await seedDeck(db, 'Biology');
  await review(bio, 'a', T0 + 25 * HOUR);
  const clock = fixedClock(T0 + 14 * HOUR);
  await renderApp({ db, clock, fakeTimers: true });
  expect(await screen.findByRole('heading', { name: 'All done for today' })).toBeTruthy();
  clock.advance(10 * HOUR);
  await act(async () => vi.advanceTimersByTime(61_000));
  expect(await screen.findByRole('heading', { name: '1 card due today' })).toBeTruthy();
});

test('Today refreshes when the window becomes visible again', async () => {
  const bio = await seedDeck(db, 'Biology');
  await review(bio, 'a', T0 + 25 * HOUR);
  const clock = fixedClock(T0 + 14 * HOUR);
  await renderApp({ db, clock });
  expect(await screen.findByRole('heading', { name: 'All done for today' })).toBeTruthy();
  clock.advance(10 * HOUR);
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  expect(await screen.findByRole('heading', { name: '1 card due today' })).toBeTruthy();
});
