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
  await screen.findByRole('heading', { name: '2 cards due today' });
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

test('Ctrl+, opens Settings', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await screen.findByRole('heading', { name: '2 cards due today' });
  await user.keyboard('{Control>},{/Control}');
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
});

test('Ctrl+Z outside Study undoes the last action with a toast', async () => {
  const db = await seeded();
  const { user, deps } = await renderApp({ db });
  await screen.findByRole('heading', { name: '2 cards due today' });
  const deckId = (await db.query<{ id: number }>(`SELECT id FROM decks WHERE name = 'Chemistry'`))[0]!.id;
  await seedNote(deps, deckId, 'basic', ['new', 'x']);
  expect(await countRows(db, 'notes')).toBe(3);
  await user.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Undid: add card'));
  expect(await countRows(db, 'notes')).toBe(2);
});

test('Ctrl+, opens Settings even while typing in a field', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await screen.findByRole('heading', { name: '2 cards due today' });
  const field = document.createElement('input');
  document.body.append(field);
  field.focus();
  await user.keyboard('{Control>},{/Control}');
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
  field.remove();
});
