// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { createDeck } from '../../../src/data/decks';
import { getBuiltinNoteType } from '../../../src/data/noteTypes';
import { updateSettings } from '../../../src/data/settings';
import { T0 } from '../../helpers/fixtures';
import { renderApp } from '../../helpers/renderApp';
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
  expect(within(card).getAllByRole('textbox').map((t) => t.getAttribute('aria-label'))).toEqual(['Front', 'Back']);
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
  expect(within(card).getAllByRole('textbox').map((t) => t.getAttribute('aria-label'))).toEqual(['Text', 'Extra']);
  expect(within(card).getByRole('button', { name: 'Card type: Cloze' })).toBeTruthy();
});

test('the tag prompt is gone; a tag icon sits at the bottom left with its real icon', async () => {
  const { card } = await openAddCard();
  const footer = await within(card).findByTestId('add-card-footer');
  expect(within(card).queryByRole('combobox', { name: 'Tags' })).toBeNull();
  expect(within(card).queryByPlaceholderText('Add a tag')).toBeNull();
  expect(within(card).queryByText('Tags')).toBeNull();
  const tag = within(footer).getByRole('button', { name: 'Tags' });
  expect(tag.querySelector('svg path')).not.toBeNull();
  expect(tag.querySelector('[data-placeholder="true"]')).toBeNull();
  // Leftmost in the bottom row, and after the Back field.
  expect(within(footer).getAllByRole('button')[0]).toBe(tag);
  expect(within(card).getByRole('textbox', { name: 'Back' }).compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('Add and Close sit at the bottom right, in that order, after the tag icon', async () => {
  const { card } = await openAddCard();
  const footer = await within(card).findByTestId('add-card-footer');
  expect(within(footer).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Tags', 'Add', 'Close']);
});

test('Close at the bottom closes the card; Add and the tag icon do nothing yet', async () => {
  const { user, card } = await openAddCard();
  const footer = await within(card).findByTestId('add-card-footer');
  await user.keyboard('A question');
  await user.click(within(footer).getByRole('button', { name: 'Tags' }));
  await user.click(within(footer).getByRole('button', { name: 'Add' }));
  expect(screen.getByRole('dialog', { name: 'Add card' })).toBeTruthy();
  expect((within(card).getByRole('textbox', { name: 'Front' }) as HTMLTextAreaElement).value).toBe('A question');
  await user.click(within(footer).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'Add card' })).toBeNull();
  expect(screen.getByTestId('today-decks-card')).toBeTruthy();
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
