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

function importer(over: { chooseFile?: () => Promise<string | null>; finish?: () => Promise<void> } = {}) {
  const platform: ImportPlatform = {
    installMedia: async () => {},
    removeMedia: async () => {},
    backup: async () => 'C:\\Users\\sam\\AppData\\Roaming\\Atlas\\backups\\pre-import-1.db',
  };
  return {
    staging: staged('rich-modern'),
    platform,
    chooseFile: over.chooseFile ?? (async () => 'C:\\Users\\sam\\Downloads\\Chemistry.apkg'),
    prepare: async () => ({}),
    finish: over.finish ?? (async () => {}),
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

/** Presses Esc until the card closes: the first presses are ignored while Atlas is still reading the file. */
async function closeWithEsc(user: ReturnType<typeof import('@testing-library/user-event').default.setup>) {
  await waitFor(async () => {
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull();
  }, { timeout: 10_000 });
}

async function homeWithDeck(imp?: ReturnType<typeof importer>) {
  const db = await createMigratedDb();
  await createDeck(db, { name: 'Physics' }, NOW);
  return renderApp({ db, clock: fixedClock(NOW), importer: imp });
}

test('Import on the notch opens the file picker straight away, and nothing else appears if you cancel it', async () => {
  let asked = 0;
  const { user } = await homeWithDeck(importer({ chooseFile: async () => (asked++, null) }));
  await user.click(await screen.findByRole('button', { name: 'Import' }));
  await waitFor(() => expect(asked).toBe(1));
  expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull();
  expect(screen.queryByTestId('import-overlay')).toBeNull();
  expect(screen.getByTestId('today-screen')).toBeTruthy();
});

test('choosing a file opens a card over a darkened window; Esc closes it, discards the file and returns focus', async () => {
  let finished = 0;
  const { user } = await homeWithDeck(importer({ finish: async () => void finished++ }));
  await user.click(await screen.findByRole('button', { name: 'Import' }));
  const card = await screen.findByRole('dialog', { name: 'Import' });
  expect(card.getAttribute('aria-modal')).toBe('true');
  // Top right: the triple-dot button, then the close button. Nothing else yet.
  expect(within(card).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['More options', 'Close']);
  expect(card.textContent).toBe('');
  // The home screen is still behind it, not replaced.
  expect(screen.getByTestId('today-screen')).toBeTruthy();
  await closeWithEsc(user);
  await waitFor(() => expect(finished).toBeGreaterThan(0));
  expect(screen.getByRole('button', { name: 'Import' })).toBe(document.activeElement);
});

test('a click outside the card closes it', async () => {
  const { user } = await homeWithDeck(importer());
  await user.click(await screen.findByRole('button', { name: 'Import' }));
  await screen.findByRole('dialog', { name: 'Import' });
  await waitFor(async () => {
    await user.click(screen.getByTestId('import-overlay'));
    expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull();
  }, { timeout: 10_000 });
});

test('the X in the card closes it; the triple-dot button does nothing yet; clicking inside the card does not close it', async () => {
  const { user } = await homeWithDeck(importer());
  await user.click(await screen.findByRole('button', { name: 'Import' }));
  const card = await screen.findByRole('dialog', { name: 'Import' });
  await user.click(card);
  await user.click(within(card).getByRole('button', { name: 'More options' }));
  expect(screen.getByRole('dialog', { name: 'Import' })).toBeTruthy();
  await waitFor(async () => {
    await user.click(within(card).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull();
  }, { timeout: 10_000 });
  expect(screen.getByRole('button', { name: 'Import' })).toBe(document.activeElement);
});

test('without an importer, Import on the notch does nothing', async () => {
  const { user } = await homeWithDeck();
  await user.click(await screen.findByRole('button', { name: 'Import' }));
  expect(screen.queryByTestId('import-overlay')).toBeNull();
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
