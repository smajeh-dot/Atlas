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

test('the card is split into two halves: Front and Back in the left one, the right one blank, and the bottom row under both', async () => {
  const { card } = await openAddCard();
  const left = (await within(card).findByRole('textbox', { name: 'Front' })).closest('[class*="fields"]') as HTMLElement;
  const halves = left.parentElement as HTMLElement;
  expect(halves.children).toHaveLength(2);
  expect(halves.children[0]).toBe(left);
  expect(within(left).getAllByRole('textbox').map((t) => t.getAttribute('aria-label'))).toEqual(['Front', 'Back']);
  const right = within(card).getByTestId('add-card-right');
  expect(halves.children[1]).toBe(right);
  expect(right.children).toHaveLength(0);
  expect(right.textContent).toBe('');
  const footer = within(card).getByTestId('add-card-footer');
  expect(halves.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(halves.contains(footer)).toBe(false);
});
