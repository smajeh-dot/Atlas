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

test('there is no sidebar: Home fills the window with just the notch, the decks card and the heatmap', async () => {
  await renderApp({ db: await seeded() });
  await screen.findByTestId('today-screen');
  expect(screen.queryByRole('complementary')).toBeNull();
  // Nothing is left of the old sidebar's buttons or deck list.
  for (const name of ['New', 'Decks', 'Home', 'Search']) expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.queryByRole('list', { name: 'Decks' })).toBeNull();
  expect(screen.queryByTestId('sidebar-user')).toBeNull();
  // Each deck appears once, in the decks card.
  expect(await screen.findAllByRole('button', { name: 'Chemistry options' })).toHaveLength(1);
});

test('the Home button in the title row of Settings returns to the home screen', async () => {
  const { user } = await renderApp({ db: await seeded(), route: { name: 'settings' } });
  await screen.findByRole('heading', { name: 'Settings' });
  await user.click(screen.getByRole('button', { name: 'Home' }));
  expect(await screen.findByTestId('today-decks-card')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
});

test('the gear in the corner of Home opens Settings', async () => {
  const { user } = await renderApp({ db: await seeded() });
  await screen.findByTestId('today-decks-card');
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
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
  expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Study', 'Add card here', 'Add subdeck', 'Rename', 'Colour', 'Delete']);
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

test('Add on the notch opens a large card over Home, which stays put underneath', async () => {
  const { user } = await renderApp({ db: await seeded() });
  const decksCard = await screen.findByTestId('today-decks-card');
  const add = within(screen.getByTestId('today-notch')).getByRole('button', { name: 'Add' });
  await user.click(add);
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  expect(card.getAttribute('aria-modal')).toBe('true');
  // Along the top: the card type, then the deck. In the corner: just the close button.
  expect(await within(card).findByRole('button', { name: 'Deck: <b>Bio</b>' })).toBeTruthy();
  // (then the bottom row: Add and Close; the tag icon is not a button).
  expect(within(card).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(
    ['Card type: Basic', 'Deck: <b>Bio</b>', ...FORMAT_BUTTONS, 'Add', 'Close', 'Close'],
  );
  // Home is still there underneath, the very same elements rather than a reload.
  expect(screen.getByTestId('today-decks-card')).toBe(decksCard);
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

test('the Add card overlay shows the card type, then the deck; the type button opens a dropdown of four rows', async () => {
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
  expect(screen.queryByRole('menu')).toBeNull();
  await user.click(type);
  const menu = await screen.findByRole('menu', { name: 'Card type' });
  expect(within(menu).getAllByRole('menuitem').map((r) => r.textContent)).toEqual(['Subject', 'Folder', 'Basic', 'Image Occlusion']);
  // Opening the deck dropdown swaps it for that one; picking a row just closes the menu.
  await user.click(deck);
  expect(screen.queryByRole('menu', { name: 'Card type' })).toBeNull();
  await user.click(type);
  await user.click(within(await screen.findByRole('menu', { name: 'Card type' })).getByRole('menuitem', { name: 'Folder' }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(type.textContent).toBe('Folder');
  expect(screen.getByRole('dialog', { name: 'Add card' })).toBeTruthy();
});

test.each(['Subject', 'Folder', 'Image Occlusion'])('%s opens a blank card: only the type and deck buttons, Add, Close and the X; Basic brings the full card back', async (row) => {
  const { user } = await renderApp({ db: await seeded() });
  await user.click(within(await screen.findByTestId('today-notch')).getByRole('button', { name: 'Add' }));
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  await within(card).findByRole('textbox', { name: 'Front' });
  await user.click(within(card).getByRole('button', { name: /^Card type: / }));
  await user.click(within(await screen.findByRole('menu', { name: 'Card type' })).getByRole('menuitem', { name: row }));
  const type = within(card).getByRole('button', { name: `Card type: ${row}` });
  expect(type.textContent).toBe(row);
  expect(within(card).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([`Card type: ${row}`, 'Deck: <b>Bio</b>', 'Add', 'Close', 'Close']);
  expect(within(card).queryAllByRole('textbox')).toEqual([]);
  expect(within(card).queryByRole('toolbar')).toBeNull();
  expect(card.querySelector('[data-testid="add-card-tag-icon"], [data-testid="add-card-preview"]')).toBeNull();
  expect(within(card).getByTestId('add-card-blank').children).toHaveLength(0);
  // Back to Basic: the full card.
  await user.click(type);
  await user.click(within(await screen.findByRole('menu', { name: 'Card type' })).getByRole('menuitem', { name: 'Basic' }));
  expect(await within(card).findByRole('textbox', { name: 'Front' })).toBeTruthy();
  expect(within(card).getByRole('toolbar', { name: 'Formatting' })).toBeTruthy();
  expect(within(card).getByRole('button', { name: 'Card type: Basic' })).toBeTruthy();
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

/** The text-editing buttons under the card type and deck, left to right. */
const FORMAT_BUTTONS = [
  'Bold', 'Italic', 'Underline', 'Colour',
  'Bulleted list', 'Numbered list',
  'Align left', 'Align centre', 'Align right', 'Justify',
  'Attach file',
];

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

test('under the type and deck buttons: bold to colour, the two lists, four alignments, then attach file, with breaks between', async () => {
  const { user, card } = await openAddCard(await withSubjects());
  const bar = await within(card).findByRole('toolbar', { name: 'Formatting' });
  // Below the card type and deck buttons.
  const deck = within(card).getByRole('button', { name: /^Deck: / });
  expect(deck.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const buttons = within(bar).getAllByRole('button');
  expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(FORMAT_BUTTONS);
  // Groups of 4, 2, 4 and 1, with a break between each.
  const groups = [...bar.children].map((g) => within(g as HTMLElement).queryAllByRole('button').length);
  expect(groups).toEqual([4, 2, 4, 1]);
  expect(within(bar).getAllByRole('separator')).toHaveLength(3);
  // Every button has its real icon now; none is the dashed placeholder any more.
  expect(buttons.map((b) => b.querySelector('[data-placeholder="true"]') !== null)).toEqual(Array(11).fill(false));
  expect(buttons.every((b) => b.querySelector('svg path') !== null)).toBe(true);
  // They look active but do nothing yet.
  for (const b of buttons) await user.click(b);
  expect(screen.getByRole('dialog', { name: 'Add card' })).toBeTruthy();
  expect(screen.queryByRole('menu')).toBeNull();
});

test('the X in the Add card overlay closes it and returns focus; there is no triple-dot button', async () => {
  const { user } = await renderApp({ db: await seeded() });
  const add = within(await screen.findByTestId('today-notch')).getByRole('button', { name: 'Add' });
  await user.click(add);
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  const corner = within(screen.getByTestId('add-card-corner'));
  expect(corner.queryByRole('button', { name: 'More options' })).toBeNull();
  await user.click(corner.getByRole('button', { name: 'Close' }));
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
