// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { UndoStack } from '../../src/services/undo';
import { createDeck, listDecks } from '../../src/data/decks';
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

test('the sidebar Home button returns to the home screen with the decks card', async () => {
  const { user } = await renderApp({ db: await seeded(), route: { name: 'settings' } });
  await screen.findByRole('heading', { name: 'Settings' });
  const today = screen.getByRole('button', { name: 'Home' });
  expect(today.getAttribute('aria-current')).toBeNull();
  await user.click(today);
  expect(await screen.findByTestId('today-decks-card')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
});

test('the blank notch hangs from the top of Today and appears on no other screen', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await screen.findByTestId('today-screen');
  expect(screen.getByTestId('today-notch')).toBeTruthy();
  await user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { name: 'Settings' });
  expect(screen.queryByTestId('today-notch')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Home' }));
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

test('Today shows a year-long heatmap with month names, below the decks card', async () => {
  await renderApp({ db: await seeded() });
  const activity = await screen.findByTestId('today-activity');
  const map = within(activity).getByRole('img', { name: 'Reviews per day over the last year' });
  expect(map.children).toHaveLength(53);
  expect(activity.textContent).toMatch(/Jan.*Feb.*Mar/);
  expect(within(activity).getByText(String(new Date(T0).getFullYear()))).toBeTruthy();
  expect(within(activity).queryByText('Activity')).toBeNull();
  expect(within(activity).queryByText('Last year')).toBeNull();
  const decks = screen.getByTestId('today-decks-card');
  expect(decks.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('the sidebar has no Search button', async () => {
  await renderApp({ db: await seeded() });
  await screen.findByTestId('today-screen');
  expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
});

test('the decks card lists your real decks with their counts, not placeholders', async () => {
  await renderApp({ db: await seeded() });
  const card = await screen.findByTestId('today-decks-card');
  const bio = await within(card).findByRole('button', { name: /^<b>Bio<\/b>\d/ });
  expect(bio.querySelector('[data-count="due"]')!.textContent).toBe('2');
  expect(within(card).getByRole('button', { name: /^Chemistry\d/ })).toBeTruthy();
  expect(within(card).queryByText('Sub-deck one')).toBeNull();
});

test('clicking a deck with no sub-decks starts studying it', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await user.click(await screen.findByRole('button', { name: /^<b>Bio<\/b>\d/ }));
  expect(await screen.findByRole('button', { name: 'Leave study' })).toBeTruthy();
});

test('clicking a deck with sub-decks opens and closes it, and remembers that', async () => {
  const db = await createMigratedDb();
  const parent = await createDeck(db, { name: 'Parent' }, T0);
  await createDeck(db, { name: 'Child', parentId: parent }, T0);
  const { user } = await renderApp({ db });
  const row = await screen.findByRole('button', { name: /^Parent\d/ });
  expect(row.getAttribute('aria-expanded')).toBe('true');
  await user.click(row);
  await waitFor(async () => expect((await listDecks(db)).find((d) => d.name === 'Parent')!.collapsed).toBe(true));
  await waitFor(() => expect(screen.getByRole('button', { name: /^Parent\d/ }).getAttribute('aria-expanded')).toBe('false'));
  await user.click(screen.getByRole('button', { name: /^Parent\d/ }));
  await waitFor(async () => expect((await listDecks(db)).find((d) => d.name === 'Parent')!.collapsed).toBe(false));
});

test('a deck\'s three-dot button opens the menu card, whose items do real things', async () => {
  const db = await seeded();
  const { user } = await renderApp({ db });
  await user.click(await screen.findByRole('button', { name: 'Chemistry options' }));
  const menu = await screen.findByRole('menu', { name: 'Chemistry options' });
  expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Study', 'Add card here', 'Add subdeck', 'Rename', 'Colour', 'Deck options', 'Delete']);
  await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
  await user.type(await screen.findByLabelText('Deck name'), '{Control>}a{/Control}Chem{Enter}');
  await waitFor(async () => expect((await listDecks(db)).map((d) => d.name).sort()).toEqual(['<b>Bio</b>', 'Chem']));
});

test('Colour in a deck\'s menu card opens a colour card and saves the choice', async () => {
  const db = await seeded();
  const { user } = await renderApp({ db });
  await user.click(await screen.findByRole('button', { name: 'Chemistry options' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Colour' }));
  const colours = await screen.findByRole('menu', { name: 'Colour' });
  await user.click(within(colours).getByRole('menuitem', { name: 'Purple' }));
  await waitFor(async () => expect((await listDecks(db)).find((d) => d.name === 'Chemistry')!.colour).toBe(5));
});

test('a sub-deck\'s menu card has no Colour item', async () => {
  const db = await createMigratedDb();
  const parent = await createDeck(db, { name: 'Parent' }, T0);
  await createDeck(db, { name: 'Child', parentId: parent }, T0);
  const { user } = await renderApp({ db });
  await user.click(await screen.findByRole('button', { name: 'Child options' }));
  const menu = await screen.findByRole('menu', { name: 'Child options' });
  expect(within(menu).queryByRole('menuitem', { name: 'Colour' })).toBeNull();
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
