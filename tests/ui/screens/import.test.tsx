// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { createDeck } from '../../../src/data/decks';
import type { ImportPlatform } from '../../../src/import/commit';
import { fixedClock } from '../../helpers/fixtures';
import { countRows } from '../../helpers/seed';
import { renderApp } from '../../helpers/renderApp';
import { createMigratedDb } from '../../helpers/testDb';
import { staged } from '../../import/helpers';

const NOW = 1793821483999; // when the rich-modern test package was exported

function importer() {
  const platform: ImportPlatform = {
    installMedia: async () => {},
    removeMedia: async () => {},
    backup: async () => 'C:\\Users\\sam\\AppData\\Roaming\\Atlas\\backups\\pre-import-1.db',
  };
  return {
    staging: staged('rich-modern'),
    platform,
    chooseFile: async () => 'C:\\Users\\sam\\Downloads\\Chemistry.apkg',
    prepare: async () => ({}),
    finish: async () => {},
  };
}

test('a new student imports their Anki deck from the Welcome screen and lands on their decks', async () => {
  const { user, db } = await renderApp({ clock: fixedClock(NOW), importer: importer() });
  await user.click(await screen.findByRole('button', { name: 'Import from Anki' }));
  await screen.findByRole('heading', { name: 'Import from Anki' });
  await user.click(screen.getByRole('button', { name: 'Choose a file…' }));

  await screen.findByText('Chemistry.apkg');
  expect(screen.getByText(/Your progress comes with it/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Import' }));

  await screen.findByText('Imported Chemistry.apkg', {}, { timeout: 10_000 });
  expect(await countRows(db, 'notes')).toBe(30);
  expect(screen.getByText(/pre-import-1\.db/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Import from Anki' })).toBeNull());
  expect(screen.queryByRole('button', { name: 'Start from scratch' })).toBeNull();
});

test('Import in the Today notch opens a card over a darkened window; Esc and a click outside close it', async () => {
  const db = await createMigratedDb();
  await createDeck(db, { name: 'Physics' }, NOW);
  const { user } = await renderApp({ db, clock: fixedClock(NOW), importer: importer() });
  await user.click(await screen.findByRole('button', { name: 'Import' }));
  const card = await screen.findByRole('dialog', { name: 'Import' });
  expect(card.getAttribute('aria-modal')).toBe('true');
  // Top right: the triple-dot button, then the close button. Nothing else yet.
  expect(within(card).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['More options', 'Close']);
  expect(card.textContent).toBe('');
  // The home screen is still behind it, not replaced.
  expect(screen.getByTestId('today-screen')).toBeTruthy();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull());
  expect(screen.getByRole('button', { name: 'Import' })).toBe(document.activeElement);

  await user.click(screen.getByRole('button', { name: 'Import' }));
  await screen.findByRole('dialog', { name: 'Import' });
  await user.click(screen.getByTestId('import-overlay'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull());
});

test('the X in the card closes it; the triple-dot button does nothing yet', async () => {
  const db = await createMigratedDb();
  await createDeck(db, { name: 'Physics' }, NOW);
  const { user } = await renderApp({ db, clock: fixedClock(NOW), importer: importer() });
  await user.click(await screen.findByRole('button', { name: 'Import' }));
  const card = await screen.findByRole('dialog', { name: 'Import' });
  await user.click(within(card).getByRole('button', { name: 'More options' }));
  expect(screen.getByRole('dialog', { name: 'Import' })).toBeTruthy();
  await user.click(within(card).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull());
  expect(screen.getByRole('button', { name: 'Import' })).toBe(document.activeElement);
});

test('clicking inside the card does not close it', async () => {
  const db = await createMigratedDb();
  await createDeck(db, { name: 'Physics' }, NOW);
  const { user } = await renderApp({ db, clock: fixedClock(NOW), importer: importer() });
  await user.click(await screen.findByRole('button', { name: 'Import' }));
  await user.click(await screen.findByRole('dialog', { name: 'Import' }));
  expect(screen.getByRole('dialog', { name: 'Import' })).toBeTruthy();
});

test('without an importer (tests, browser preview) the Welcome screen offers only Start from scratch', async () => {
  await renderApp();
  await screen.findByRole('button', { name: 'Start from scratch' });
  expect(screen.queryByRole('button', { name: 'Import from Anki' })).toBeNull();
});

test('a start-up notice, such as an undone import, is shown once', async () => {
  await renderApp({ notice: "An import didn't finish last time Atlas was open, so Atlas undid it." });
  await screen.findByText(/An import didn't finish last time/);
});
