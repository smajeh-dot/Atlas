// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { createDeck } from '../../../src/data/decks';
import { getBuiltinNoteType } from '../../../src/data/noteTypes';
import { getSettings, updateSettings } from '../../../src/data/settings';
import { T0 } from '../../helpers/fixtures';
import { renderApp } from '../../helpers/renderApp';
import { countRows } from '../../helpers/seed';
import { createMigratedDb } from '../../helpers/testDb';

// ProseMirror can't be typed into under jsdom, so the field editor is a plain textarea here.
vi.mock('../../../src/ui/editor/FieldEditor', () => import('../../helpers/fieldEditorStub'));

async function openAddCard(lastType?: 'cloze') {
  const db = await createMigratedDb();
  await createDeck(db, { name: 'Physics' }, T0);
  if (lastType) await updateSettings(db, { lastNoteTypeId: (await getBuiltinNoteType(db, lastType)).id });
  const r = await renderApp({ db });
  await r.user.click(within(await screen.findByTestId('today-notch')).getByRole('button', { name: 'Add' }));
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  await within(card).findByRole('toolbar', { name: 'Formatting' });
  return { ...r, card };
}

test('the Add card overlay has a Front field, then a Back field, below the toolbar', async () => {
  const { card } = await openAddCard();
  const front = await within(card).findByRole('textbox', { name: 'Front' });
  const back = within(card).getByRole('textbox', { name: 'Back' });
  const toolbar = within(card).getByRole('toolbar', { name: 'Formatting' });
  expect(within(card).getAllByRole('textbox').map((t) => t.getAttribute('aria-label'))).toEqual(['Front', 'Back', null]);
  expect(toolbar.compareDocumentPosition(front) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(front.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('each field keeps what you type, separately, and the first one has the cursor', async () => {
  const { user, card } = await openAddCard();
  const front = await within(card).findByRole('textbox', { name: 'Front' });
  expect(document.activeElement).toBe(front);
  await user.keyboard('What is 2 + 2?');
  await user.click(within(card).getByRole('textbox', { name: 'Back' }));
  await user.keyboard('Four');
  expect((front as HTMLTextAreaElement).value).toBe('What is 2 + 2?');
  expect((within(card).getByRole('textbox', { name: 'Back' }) as HTMLTextAreaElement).value).toBe('Four');
});

test('Esc still closes the card from inside a field', async () => {
  const { user, card } = await openAddCard();
  await within(card).findByRole('textbox', { name: 'Front' });
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Add card' })).toBeNull();
});

test('the fields follow the card type: a Cloze card has Text and Extra', async () => {
  const { card } = await openAddCard('cloze');
  await within(card).findByRole('textbox', { name: 'Text' });
  expect(within(card).getAllByRole('textbox').map((t) => t.getAttribute('aria-label'))).toEqual(['Text', 'Extra', null]);
  expect(within(card).getByRole('button', { name: 'Card type: Cloze' })).toBeTruthy();
});

test('a tag icon sits at the bottom left with its real icon, is not clickable, and has a tags field beside it', async () => {
  const { card } = await openAddCard();
  const footer = await within(card).findByTestId('add-card-footer');
  const tag = within(footer).getByTestId('add-card-tag-icon');
  expect(tag.querySelector('svg path')).not.toBeNull();
  expect(tag.querySelector('[data-placeholder="true"]')).toBeNull();
  expect(tag.closest('button')).toBeNull();
  expect(within(footer).queryByRole('button', { name: 'Tags' })).toBeNull();
  // The field sits right after the icon, and the whole thing is after the Back field.
  const field = within(footer).getByRole('textbox', { name: 'Tags' });
  expect(tag.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(card).getByRole('textbox', { name: 'Back' }).compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('Add and Close sit at the bottom right, in that order, after the tag icon and field', async () => {
  const { card } = await openAddCard();
  const footer = await within(card).findByTestId('add-card-footer');
  expect(within(footer).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Add', 'Close']);
});

test('Close at the bottom closes the card, and the tags field takes typing', async () => {
  const { user, card } = await openAddCard();
  const footer = await within(card).findByTestId('add-card-footer');
  await user.keyboard('A question');
  await user.click(within(footer).getByRole('textbox', { name: 'Tags' }));
  await user.keyboard('chem');
  expect(within(footer).getByRole('textbox', { name: 'Tags' })).toHaveProperty('value', 'chem');
  expect(screen.getByRole('dialog', { name: 'Add card' })).toBeTruthy();
  expect((within(card).getByRole('textbox', { name: 'Front' }) as HTMLTextAreaElement).value).toBe('A question');
  await user.click(within(footer).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'Add card' })).toBeNull();
  expect(screen.getByTestId('today-decks-card')).toBeTruthy();
});

const textOf = (el: HTMLElement) => (el as HTMLTextAreaElement).value;
const addButton = (card: HTMLElement) => within(within(card).getByTestId('add-card-footer')).getByRole('button', { name: 'Add' });

test('Add saves the card in the chosen deck, empties the fields, puts the cursor back on the Front, and keeps the card open', async () => {
  const { user, card, db } = await openAddCard();
  const front = await within(card).findByRole('textbox', { name: 'Front' });
  await user.keyboard('What is 2 + 2?');
  await user.click(within(card).getByRole('textbox', { name: 'Back' }));
  await user.keyboard('Four');
  await user.click(addButton(card));

  await waitFor(() => expect(textOf(front)).toBe(''));
  expect(textOf(within(card).getByRole('textbox', { name: 'Back' }))).toBe('');
  expect(document.activeElement).toBe(front);
  expect(screen.getByRole('dialog', { name: 'Add card' })).toBeTruthy();

  const notes = await db.query<{ fields: string; deck_id: number }>(
    `SELECT n.fields, c.deck_id FROM notes n JOIN cards c ON c.note_id = n.id`,
  );
  expect(notes).toHaveLength(1);
  expect(JSON.parse(notes[0]!.fields)).toEqual(['What is 2 + 2?', 'Four']);
  const [physics] = await db.query<{ id: number }>(`SELECT id FROM decks WHERE name = 'Physics'`);
  expect(notes[0]!.deck_id).toBe(physics!.id);
});

test('Home behind the card counts the new card straight away', async () => {
  const { user, card } = await openAddCard();
  await within(card).findByRole('textbox', { name: 'Front' });
  const newCount = () => within(screen.getByTestId('today-decks-card')).getByText((_, el) => el?.getAttribute('data-count') === 'new').textContent;
  expect(newCount()).toBe('0');
  await user.keyboard('A question');
  await user.click(addButton(card));
  await waitFor(() => expect(newCount()).toBe('1'));
});

test('Add with nothing in the Front saves nothing, says why, and keeps what was typed', async () => {
  const { user, card, db } = await openAddCard();
  await user.click(await within(card).findByRole('textbox', { name: 'Back' }));
  await user.keyboard('Only a back');
  await user.click(addButton(card));

  expect(await screen.findByText(/would not make any cards/)).toBeTruthy();
  expect(textOf(within(card).getByRole('textbox', { name: 'Back' }))).toBe('Only a back');
  expect(await countRows(db, 'notes')).toBe(0);
  expect(await countRows(db, 'cards')).toBe(0);
});

test('Add on a blank view (Folder) saves nothing, even though Basic fields were typed in before switching', async () => {
  const { user, card, db } = await openAddCard();
  await within(card).findByRole('textbox', { name: 'Front' });
  await user.keyboard('Typed before switching');
  await user.click(within(card).getByRole('button', { name: 'Card type: Basic' }));
  await user.click(within(await screen.findByRole('menu', { name: 'Card type' })).getByRole('menuitem', { name: 'Folder' }));
  await within(card).findByTestId('add-card-blank');
  await user.click(addButton(card));
  expect(await countRows(db, 'notes')).toBe(0);
  expect(await countRows(db, 'cards')).toBe(0);
});

test('a double click on Add saves one card, not two', async () => {
  const { user, card, db } = await openAddCard();
  await within(card).findByRole('textbox', { name: 'Front' });
  await user.keyboard('Once only');
  await user.dblClick(addButton(card));
  await waitFor(async () => expect(await countRows(db, 'cards')).toBeGreaterThan(0));
  await waitFor(() => expect(textOf(within(card).getByRole('textbox', { name: 'Front' }))).toBe(''));
  expect(await countRows(db, 'cards')).toBe(1);
});

test('the deck and card type you added with are remembered for next time', async () => {
  const db = await createMigratedDb();
  await createDeck(db, { name: 'Physics' }, T0);
  const chemistry = await createDeck(db, { name: 'Chemistry' }, T0);
  const r = await renderApp({ db });
  await r.user.click(within(await screen.findByTestId('today-notch')).getByRole('button', { name: 'Add' }));
  const card = await screen.findByRole('dialog', { name: 'Add card' });
  await within(card).findByRole('toolbar', { name: 'Formatting' });

  await r.user.click(within(card).getByRole('button', { name: /^Deck:/ }));
  await r.user.click(await screen.findByRole('menuitemradio', { name: 'Chemistry' }));
  await r.user.click(await within(card).findByRole('textbox', { name: 'Front' }));
  await r.user.keyboard('Symbol for gold?');
  await r.user.click(addButton(card));

  const basic = await getBuiltinNoteType(db, 'basic');
  await waitFor(async () => {
    const s = await getSettings(db);
    expect(s.lastDeckId).toBe(chemistry);
    expect(s.lastNoteTypeId).toBe(basic.id);
  });
  expect(within(card).getByRole('button', { name: 'Deck: Chemistry' })).toBeTruthy();
});

test('the card is split into two halves: Front and Back in the left one, the live preview in the right, and the bottom row under both', async () => {
  const { card } = await openAddCard();
  const left = (await within(card).findByRole('textbox', { name: 'Front' })).closest('[class*="fields"]') as HTMLElement;
  const halves = left.parentElement as HTMLElement;
  expect(halves.children).toHaveLength(2);
  expect(halves.children[0]).toBe(left);
  expect(within(left).getAllByRole('textbox').map((t) => t.getAttribute('aria-label'))).toEqual(['Front', 'Back']);
  const right = within(card).getByTestId('add-card-right');
  expect(halves.children[1]).toBe(right);
  // The right half holds the live preview card.
  expect(right.children).toHaveLength(1);
  expect(within(right).getByTestId('add-card-preview')).toBeTruthy();
  const footer = within(card).getByTestId('add-card-footer');
  expect(halves.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(halves.contains(footer)).toBe(false);
});

/** What the preview card is showing, as text (it draws inside a shadow root). */
const previewText = (card: HTMLElement) => {
  const host = within(card).getByTestId('add-card-preview').querySelector('[data-cardview]');
  return host?.shadowRoot?.querySelector('.atlas-card')?.textContent ?? '';
};

test('the preview card is blank until there is something to show, and then follows what you type', async () => {
  const { user, card } = await openAddCard();
  const front = await within(card).findByRole('textbox', { name: 'Front' });
  const preview = within(card).getByTestId('add-card-preview');
  expect(preview.querySelector('[data-cardview]')).toBeNull();
  expect(previewText(card)).toBe('');
  // Only a Back: Basic makes no card from that, so still blank.
  await user.click(within(card).getByRole('textbox', { name: 'Back' }));
  await user.keyboard('Four');
  expect(previewText(card)).toBe('');
  // A Front makes the card: the front, the Answer divider, then the back.
  await user.click(front);
  await user.keyboard('What is 2 + 2?');
  expect(previewText(card)).toContain('What is 2 + 2?');
  expect(previewText(card)).toContain('Answer');
  expect(previewText(card)).toContain('Four');
  // Live: more typing shows up straight away.
  await user.keyboard(' (hint)');
  expect(previewText(card)).toContain('What is 2 + 2? (hint)');
  // And emptying the Front takes the card away again.
  await user.clear(front);
  expect(previewText(card)).toBe('');
});

test('the preview card draws Obsidian-style equations with KaTeX as you finish typing them', async () => {
  const { user, card } = await openAddCard();
  await user.click(await within(card).findByRole('textbox', { name: 'Front' }));
  await user.keyboard('Solve $x^2');
  const root = () => within(card).getByTestId('add-card-preview').querySelector('[data-cardview]')!.shadowRoot!;
  // One dollar sign is just text.
  expect(root().querySelector('.katex')).toBeNull();
  expect(previewText(card)).toContain('Solve $x^2');
  await user.keyboard('$ now');
  expect(root().querySelector('.katex')).not.toBeNull();
  expect(previewText(card)).not.toContain('$');
});
