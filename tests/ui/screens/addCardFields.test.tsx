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
