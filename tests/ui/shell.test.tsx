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

test('sidebar lists subjects with due counts as plain text', async () => {
  await renderApp({ db: await seeded() });
  const subjects = await screen.findByRole('list', { name: 'Subjects' });
  await waitFor(() => expect(within(subjects).getAllByRole('button')).toHaveLength(2));
  const bio = within(subjects).getByRole('button', { name: /<b>Bio<\/b>/ });
  expect(bio.textContent).toBe('<b>Bio</b>2');
  expect(subjects.querySelector('b')).toBeNull();
  expect(within(subjects).getByRole('button', { name: /Chemistry/ }).textContent).toBe('Chemistry0');
});

test('clicking a subject studies it', async () => {
  const { user } = await renderApp({ db: await seeded() });
  const subjects = await screen.findByRole('list', { name: 'Subjects' });
  await user.click(await within(subjects).findByRole('button', { name: /Chemistry/ }));
  expect(await screen.findByRole('button', { name: 'Leave study' })).toBeTruthy();
  expect(screen.queryByRole('navigation')).toBeNull();
});

test('A opens Add card, but not while typing', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await screen.findByRole('list', { name: 'Subjects' });
  const stray = document.createElement('input');
  document.body.append(stray);
  stray.focus();
  await user.keyboard('a');
  expect(screen.queryByRole('heading', { name: 'Add card' })).toBeNull();
  stray.blur();
  stray.remove();
  await user.keyboard('a');
  expect(await screen.findByRole('heading', { name: 'Add card' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add card' }).getAttribute('aria-current')).toBe('page');
});

test('Ctrl+, opens Settings', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await screen.findByRole('list', { name: 'Subjects' });
  await user.keyboard('{Control>},{/Control}');
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
});

test('Ctrl+Z outside Study undoes the last action with a toast', async () => {
  const db = await seeded();
  const { user, deps } = await renderApp({ db });
  await screen.findByRole('list', { name: 'Subjects' });
  const deckId = (await db.query<{ id: number }>(`SELECT id FROM decks WHERE name = 'Chemistry'`))[0]!.id;
  await seedNote(deps, deckId, 'basic', ['new', 'x']);
  expect(await countRows(db, 'notes')).toBe(3);
  await user.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Undid: add card'));
  expect(await countRows(db, 'notes')).toBe(2);
});

test('with no decks, Today and Decks are disabled and Welcome shows', async () => {
  await renderApp();
  expect(await screen.findByRole('heading', { name: 'Welcome to Atlas' })).toBeTruthy();
  const nav = screen.getByRole('navigation');
  expect(within(nav).getByRole('button', { name: 'Today' }).getAttribute('aria-disabled')).toBe('true');
  expect(within(nav).getByRole('button', { name: 'Decks' }).getAttribute('aria-disabled')).toBe('true');
  expect(within(nav).queryByRole('button', { name: 'Browse' })).toBeNull();
});
