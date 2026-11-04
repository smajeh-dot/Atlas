// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Db } from '../../../src/data/db';
import { getCard } from '../../../src/data/cards';
import { getNote } from '../../../src/data/notes';
import { UndoStack } from '../../../src/services/undo';
import { EditCardSheet } from '../../../src/ui/screens/Editor/EditCardSheet';
import { createMigratedDb } from '../../helpers/testDb';
import { fixedClock, T0 } from '../../helpers/fixtures';
import { countRows, seedDeck, seedNote } from '../../helpers/seed';
import { renderInApp } from '../../helpers/renderApp';

vi.mock('../../../src/ui/editor/FieldEditor', () => import('../../helpers/fieldEditorStub'));

let db: Db;
let bio: number;
let chem: number;
let deps: { db: Db; clock: ReturnType<typeof fixedClock>; undo: UndoStack };
beforeEach(async () => {
  db = await createMigratedDb();
  deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  bio = await seedDeck(db, 'Biology');
  chem = await seedDeck(db, 'Chemistry');
});

test('Save updates the note and moves the card', async () => {
  const { noteId, cardIds } = await seedNote(deps, bio, 'basic', ['Osmosis', 'water'], ['paper-1']);
  const onClose = vi.fn();
  const { user } = await renderInApp(<EditCardSheet cardId={cardIds[0]!} onClose={onClose} />, { db });
  const sheet = await screen.findByRole('dialog', { name: 'Edit card' });
  const front = await within(sheet).findByLabelText('Front');
  expect(front).toHaveProperty('value', 'Osmosis');
  expect(within(sheet).getByText('Basic')).toBeTruthy();
  await user.type(front, ' (biology)');
  await user.click(within(sheet).getByRole('button', { name: /^Deck / }));
  await user.keyboard('chem{Enter}');
  await user.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  expect((await getNote(db, noteId)).fields[0]).toBe('Osmosis (biology)');
  expect((await getNote(db, noteId)).tags).toEqual(['paper-1']);
  expect((await getCard(db, cardIds[0]!)).deckId).toBe(chem);
});

test('Esc with no changes closes; with changes asks to discard', async () => {
  const { cardIds } = await seedNote(deps, bio, 'basic', ['Q', 'A']);
  const onClose = vi.fn();
  const { user } = await renderInApp(<EditCardSheet cardId={cardIds[0]!} onClose={onClose} />, { db });
  const sheet = await screen.findByRole('dialog', { name: 'Edit card' });
  const front = await within(sheet).findByLabelText('Front');
  await user.click(front);
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledWith(false);
  onClose.mockClear();
  await user.type(front, 'x');
  await user.keyboard('{Escape}');
  const confirm = screen.getByRole('dialog', { name: 'Discard changes?' });
  expect(confirm.textContent).toContain("Your edits to this card haven't been saved.");
  await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
  expect(onClose).not.toHaveBeenCalled();
  await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
  await user.click(within(screen.getByRole('dialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }));
  expect(onClose).toHaveBeenCalledWith(false);
});

test('editing a cloze to add c2 creates the new card', async () => {
  const { cardIds } = await seedNote(deps, bio, 'cloze', ['The {{c1::nucleus}} holds DNA', '']);
  const onClose = vi.fn();
  const { user } = await renderInApp(<EditCardSheet cardId={cardIds[0]!} onClose={onClose} />, { db });
  const text = await within(await screen.findByRole('dialog', { name: 'Edit card' })).findByLabelText('Text');
  await user.clear(text);
  await user.type(text, 'The {{{{c1::nucleus}} holds {{{{c2::DNA}}');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  expect(await countRows(db, 'cards')).toBe(2);
});
