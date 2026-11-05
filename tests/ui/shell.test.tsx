// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { UndoStack } from '../../src/services/undo';
import { createDeck, listDecks } from '../../src/data/decks';
import { getBuiltinNoteType } from '../../src/data/noteTypes';
import { updateSettings } from '../../src/data/settings';
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

test('A opens the Add card overlay, but not while typing', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await screen.findByTestId('today-screen');
  const stray = document.createElement('input');
  document.body.append(stray);
  stray.focus();
  await user.keyboard('a');
  expect(screen.queryByRole('dialog', { name: 'Add card' })).toBeNull();
  stray.blur();
  stray.remove();
  await user.keyboard('a');
  expect(await screen.findByRole('dialog', { name: 'Add card' })).toBeTruthy();
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

test('the notch holds Import, Add, Browse and Shared, in that order; Add opens the Add card overlay and the others stay put', async () => {
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
  expect(await screen.findByRole('dialog', { name: 'Add card' })).toBeTruthy();
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

test('the sidebar list shows your real decks and sub-decks, not placeholders', async () => {
  const db = await createMigratedDb();
  const parent = await createDeck(db, { name: 'Parent' }, T0);
  await createDeck(db, { name: 'Child', parentId: parent }, T0);
  await createDeck(db, { name: 'Solo' }, T0);
  await renderApp({ db });
  const rail = await screen.findByRole('list', { name: 'Decks' });
  await within(rail).findByRole('button', { name: 'Parent' });
  expect(within(rail).getByRole('list', { name: 'Parent decks' })).toBeTruthy();
  expect(within(rail).getByRole('button', { name: 'Child' })).toBeTruthy();
  expect(within(rail).getByRole('button', { name: 'Solo' })).toBeTruthy();
  expect(screen.queryByText('Sub-deck one')).toBeNull();
});

test('in the sidebar, a deck with sub-decks folds shut and a deck without starts studying', async () => {
  const db = await seeded();
  const parent = await createDeck(db, { name: 'Parent' }, T0);
  await createDeck(db, { name: 'Child', parentId: parent }, T0);
  const { user } = await renderApp({ db });
  const rail = await screen.findByRole('list', { name: 'Decks' });
  const folder = await within(rail).findByRole('button', { name: 'Parent' });
  expect(folder.getAttribute('aria-expanded')).toBe('true');
  await user.click(folder);
  expect(within(rail).getByRole('button', { name: 'Parent' }).getAttribute('aria-expanded')).toBe('false');
  await user.click(within(rail).getByRole('button', { name: '<b>Bio</b>' }));
  expect(await screen.findByRole('button', { name: 'Leave study' })).toBeTruthy();
});

test('a sidebar deck\'s three-dot button opens the same menu card as the home screen', async () => {
  const db = await seeded();
  const { user } = await renderApp({ db });
  const rail = await screen.findByRole('list', { name: 'Decks' });
  await user.click(await within(rail).findByRole('button', { name: 'Chemistry options' }));
  const menu = await screen.findByRole('menu', { name: 'Chemistry options' });
  expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Study', 'Add card here', 'Add subdeck', 'Rename', 'Colour', 'Deck options', 'Delete']);
  await user.click(within(menu).getByRole('menuitem', { name: 'Deck options' }));
  expect(await screen.findByRole('tree', { name: 'All decks' })).toBeTruthy();
});

test('Add on the notch opens a large card over Home, which stays put underneath', async () => {
  const { user } = await renderApp({ db: await seeded() });
  const decksCard = await screen.findByTestId('today-decks-card');
  const add = within(screen.getByTestId('today-notch')).getByRole('button', { name: 'Add' });
  await user.click(add);
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  expect(card.getAttribute('aria-modal')).toBe('true');
  // Along the top: the card type, then the deck. In the corner: the triple-dot button, then the close button.
  expect(await within(card).findByRole('button', { name: 'Deck: <b>Bio</b>' })).toBeTruthy();
  expect(within(card).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Card type: Basic', 'Deck: <b>Bio</b>', 'More options', 'Close']);
  // Home is still there, the very same elements rather than a reload, and Home is still the current sidebar item.
  expect(screen.getByTestId('today-decks-card')).toBe(decksCard);
  expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
  // The overlay holds focus (Home must not take it back).
  expect(card.contains(document.activeElement)).toBe(true);
});

test('Esc closes the Add card overlay and focus returns to the Add button', async () => {
  const { user } = await renderApp({ db: await seeded() });
  const add = within(await screen.findByTestId('today-notch')).getByRole('button', { name: 'Add' });
  await user.click(add);
  await screen.findByRole('dialog', { name: 'Add card' });
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add card' })).toBeNull());
  expect(screen.getByTestId('today-decks-card')).toBeTruthy();
  expect(add).toBe(document.activeElement);
});

test('the Add card overlay shows the card type, then the deck; the type button does nothing yet', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await user.click(within(await screen.findByTestId('today-notch')).getByRole('button', { name: 'Add' }));
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  const type = await within(card).findByRole('button', { name: 'Card type: Basic' });
  const deck = within(card).getByRole('button', { name: /^Deck: / });
  expect(type.textContent).toBe('Basic');
  // Opened from the notch with no deck chosen: the first deck.
  expect(deck.textContent).toBe('<b>Bio</b>');
  // The type comes first.
  expect(type.compareDocumentPosition(deck) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await user.click(type);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Add card' })).toBeTruthy();
});

test('the Add card overlay starts on the deck it was opened for, with its full path, and on your last card type', async () => {
  const db = await seeded();
  const parent = (await listDecks(db)).find((d) => d.name === 'Chemistry')!.id;
  await createDeck(db, { name: 'Organic', parentId: parent }, T0);
  const cloze = await getBuiltinNoteType(db, 'cloze');
  await updateSettings(db, { lastNoteTypeId: cloze.id });
  const { user } = await renderApp({ db });
  await user.click(await screen.findByRole('button', { name: 'Organic options' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Add card here' }));
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  expect((await within(card).findByRole('button', { name: /^Deck: / })).textContent).toBe('Chemistry › Organic');
  expect(within(card).getByRole('button', { name: /^Card type: / }).textContent).toBe('Cloze');
});

/** Biology and Maths are subjects (they hold decks); Solo is a deck on its own. */
async function withSubjects() {
  const db = await createMigratedDb();
  const biology = await createDeck(db, { name: 'Biology' }, T0);
  await createDeck(db, { name: 'Cells', parentId: biology }, T0);
  await createDeck(db, { name: 'Genetics', parentId: biology }, T0);
  const maths = await createDeck(db, { name: 'Maths' }, T0);
  await createDeck(db, { name: 'Algebra', parentId: maths }, T0);
  await createDeck(db, { name: 'Solo' }, T0);
  return db;
}

async function openAddCard(db: Awaited<ReturnType<typeof withSubjects>>) {
  const r = await renderApp({ db });
  await r.user.click(within(await screen.findByTestId('today-notch')).getByRole('button', { name: 'Add' }));
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  const deck = await within(card).findByRole('button', { name: /^Deck: / });
  return { ...r, card, deck };
}

test('the deck dropdown lists every deck, leaves subjects out, and clicking the button again closes it', async () => {
  const { user, card, deck } = await openAddCard(await withSubjects());
  expect(deck.getAttribute('aria-expanded')).toBe('false');
  // Opened from the notch with no deck chosen: the first deck. Biology is a subject, so it is not the answer.
  expect(deck.textContent).toBe('Biology › Cells');
  await user.click(deck);
  const menu = await screen.findByRole('menu', { name: 'Deck' });
  expect(deck.getAttribute('aria-expanded')).toBe('true');
  const items = within(menu).getAllByRole('menuitemradio');
  expect(items.map((i) => i.textContent)).toEqual(['Cells', 'Genetics', 'Algebra', 'Solo']);
  expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['Biology › Cells', 'Biology › Genetics', 'Maths › Algebra', 'Solo']);
  expect(within(menu).queryByRole('menuitemradio', { name: 'Biology' })).toBeNull();
  expect(within(menu).queryByRole('menuitemradio', { name: 'Maths' })).toBeNull();
  expect(items[0]!.getAttribute('aria-checked')).toBe('true');
  await user.click(deck);
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Deck' })).toBeNull());
  expect(card.isConnected).toBe(true);
});

test('choosing a deck in the dropdown puts it on the deck button and closes the dropdown', async () => {
  const { user, card, deck } = await openAddCard(await withSubjects());
  await user.click(deck);
  await user.click(await screen.findByRole('menuitemradio', { name: 'Maths › Algebra' }));
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Deck' })).toBeNull());
  expect(within(card).getByRole('button', { name: 'Deck: Maths › Algebra' })).toBe(deck);
  expect(deck.textContent).toBe('Maths › Algebra');
  expect(deck).toBe(document.activeElement);
  expect(screen.getByRole('dialog', { name: 'Add card' })).toBeTruthy();
  // The dropdown remembers the choice.
  await user.click(deck);
  expect((await screen.findByRole('menuitemradio', { name: 'Maths › Algebra' })).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('menuitemradio', { name: 'Biology › Cells' }).getAttribute('aria-checked')).toBe('false');
});

test('Add card here on a subject starts on the first deck inside it', async () => {
  const db = await withSubjects();
  const { user } = await renderApp({ db });
  await user.click(await screen.findByRole('button', { name: 'Maths options' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Add card here' }));
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  expect((await within(card).findByRole('button', { name: /^Deck: / })).textContent).toBe('Maths › Algebra');
});

test('with the deck dropdown open, Esc closes only the dropdown, then the next Esc closes the card', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await user.click(within(await screen.findByTestId('today-notch')).getByRole('button', { name: 'Add' }));
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  const deck = await within(card).findByRole('button', { name: /^Deck: / });
  await user.click(deck);
  await screen.findByRole('menu', { name: 'Deck' });
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Deck' })).toBeNull());
  expect(screen.getByRole('dialog', { name: 'Add card' })).toBeTruthy();
  expect(deck).toBe(document.activeElement);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add card' })).toBeNull());
});

test('with the deck dropdown open, a click on the dark area closes only the dropdown', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await user.click(within(await screen.findByTestId('today-notch')).getByRole('button', { name: 'Add' }));
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  await user.click(await within(card).findByRole('button', { name: /^Deck: / }));
  await screen.findByRole('menu', { name: 'Deck' });
  await user.click(screen.getByTestId('add-card-overlay'));
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Deck' })).toBeNull());
  expect(screen.getByRole('dialog', { name: 'Add card' })).toBeTruthy();
  await user.click(screen.getByTestId('add-card-overlay'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add card' })).toBeNull());
});

test('the X in the Add card overlay closes it and returns focus; the triple-dot button does nothing yet', async () => {
  const { user } = await renderApp({ db: await seeded() });
  const add = within(await screen.findByTestId('today-notch')).getByRole('button', { name: 'Add' });
  await user.click(add);
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  await user.click(within(card).getByRole('button', { name: 'More options' }));
  expect(screen.getByRole('dialog', { name: 'Add card' })).toBeTruthy();
  await user.click(within(card).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add card' })).toBeNull());
  expect(screen.getByTestId('today-decks-card')).toBeTruthy();
  expect(add).toBe(document.activeElement);
});

test('a click outside the Add card overlay closes it; a click inside does not', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await user.click(within(await screen.findByTestId('today-notch')).getByRole('button', { name: 'Add' }));
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  await user.click(card);
  expect(screen.getByRole('dialog', { name: 'Add card' })).toBeTruthy();
  await user.click(screen.getByTestId('add-card-overlay'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add card' })).toBeNull());
});

test('a deck menu\'s Add card here opens the overlay for that deck', async () => {
  const db = await seeded();
  const chem = (await listDecks(db)).find((d) => d.name === 'Chemistry')!;
  const { user } = await renderApp({ db });
  await user.click(await screen.findByRole('button', { name: 'Chemistry options' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Add card here' }));
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  expect(card.getAttribute('data-deck-id')).toBe(String(chem.id));
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
