// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { UndoStack } from '../../src/services/undo';
import { createMigratedDb } from '../helpers/testDb';
import { DAY, fixedClock, T0 } from '../helpers/fixtures';
import { countRows, makeReview, seedDeck, seedNote } from '../helpers/seed';
import { renderApp } from '../helpers/renderApp';

async function seeded() {
  const db = await createMigratedDb();
  const deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  const bio = await seedDeck(db, '<b>Bio</b>');
  await seedDeck(db, 'Chemistry');
  for (const f of ['a', 'b']) await makeReview(db, (await seedNote(deps, bio, 'basic', [f, 'x'])).cardIds[0]!, { dueAt: T0 - DAY });
  return db;
}

test('A opens Add card, but not while typing', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await screen.findByTestId('today-screen');
  const stray = document.createElement('input');
  document.body.append(stray);
  stray.focus();
  await user.keyboard('a');
  expect(screen.queryByRole('heading', { name: 'Add card' })).toBeNull();
  stray.blur();
  stray.remove();
  await user.keyboard('a');
  expect(await screen.findByRole('heading', { name: 'Add card' })).toBeTruthy();
});

test('the sidebar Today button returns to the Today screen with the decks card', async () => {
  const { user } = await renderApp({ db: await seeded(), route: { name: 'settings' } });
  await screen.findByRole('heading', { name: 'Settings' });
  const today = screen.getByRole('button', { name: 'Today' });
  expect(today.getAttribute('aria-current')).toBeNull();
  await user.click(today);
  expect(await screen.findByTestId('today-decks-card')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-current')).toBe('page');
});

test('the blank notch hangs from the top of Today and appears on no other screen', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await screen.findByTestId('today-screen');
  expect(screen.getByTestId('today-notch')).toBeTruthy();
  await user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { name: 'Settings' });
  expect(screen.queryByTestId('today-notch')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Today' }));
  expect(await screen.findByTestId('today-notch')).toBeTruthy();
});

test('the notch holds Import, Add, Browse and Shared, in that order; Add opens Add card and the others stay put', async () => {
  const { user } = await renderApp({ db: await seeded() });
  const notch = await screen.findByTestId('today-notch');
  expect(within(notch).getAllByRole('button').map((b) => b.textContent)).toEqual(['Import', 'Add', 'Browse', 'Shared']);
  for (const name of ['Browse', 'Shared']) {
    const b = within(notch).getByRole('button', { name }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    await user.click(b);
  }
  expect(screen.getByTestId('today-screen')).toBeTruthy();
  await user.click(within(notch).getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('heading', { name: 'Add card' })).toBeTruthy();
});

test('Ctrl+, opens Settings', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await screen.findByTestId('today-screen');
  await user.keyboard('{Control>},{/Control}');
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
});

test('Ctrl+Z outside Study undoes the last action with a toast', async () => {
  const db = await seeded();
  const { user, deps } = await renderApp({ db });
  await screen.findByTestId('today-screen');
  const deckId = (await db.query<{ id: number }>(`SELECT id FROM decks WHERE name = 'Chemistry'`))[0]!.id;
  await seedNote(deps, deckId, 'basic', ['new', 'x']);
  expect(await countRows(db, 'notes')).toBe(3);
  await user.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Undid: add card'));
  expect(await countRows(db, 'notes')).toBe(2);
});

test('Ctrl+, opens Settings even while typing in a field', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await screen.findByTestId('today-screen');
  const field = document.createElement('input');
  document.body.append(field);
  field.focus();
  await user.keyboard('{Control>},{/Control}');
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
  field.remove();
});

test('a sub-deck row opens the blank session screen, and Esc returns to Today', async () => {
  const { user } = await renderApp({ db: await seeded() });
  const card = await screen.findByTestId('today-decks-card');
  await user.click(within(card).getAllByRole('button', { name: /Sub-deck one/ })[0]!);
  expect(await screen.findByTestId('session-screen')).toBeTruthy();
  expect(screen.queryByTestId('today-decks-card')).toBeNull();
  await user.keyboard('{Escape}');
  expect(await screen.findByTestId('today-decks-card')).toBeTruthy();
});

test('Study All in a subject menu opens the blank session screen', async () => {
  const { user } = await renderApp({ db: await seeded() });
  const card = await screen.findByTestId('today-decks-card');
  await user.click(within(card).getByRole('button', { name: 'Biology options' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Study All' }));
  expect(await screen.findByTestId('session-screen')).toBeTruthy();
});
