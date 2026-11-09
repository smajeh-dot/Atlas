// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Db } from '../../../src/data/db';
import { getCard } from '../../../src/data/cards';
import { UndoStack } from '../../../src/services/undo';
import { createMigratedDb } from '../../helpers/testDb';
import { DAY, fixedClock, T0 } from '../../helpers/fixtures';
import { countRows, makeReview, seedDeck, seedNote } from '../../helpers/seed';
import { renderApp } from '../../helpers/renderApp';

vi.mock('../../../src/ui/editor/FieldEditor', () => import('../../helpers/fieldEditorStub'));

let db: Db;
let deck: number;
let seedDeps: { db: Db; clock: ReturnType<typeof fixedClock>; undo: UndoStack };
beforeEach(async () => {
  db = await createMigratedDb();
  seedDeps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  deck = await seedDeck(db, 'Chemistry');
});

async function study() {
  const r = await renderApp({ db, route: { name: 'study', deckId: deck } });
  await screen.findByTestId('study-card');
  return r;
}
const card = () => document.querySelector('[data-testid="study-card"] [data-cardview]')!.shadowRoot!;

test('Ctrl+1 flags, Ctrl+0 removes it', async () => {
  const { cardIds } = await seedNote(seedDeps, deck, 'basic', ['a', 'x']);
  const { user } = await study();
  await user.keyboard('{Control>}1{/Control}');
  await waitFor(async () => expect((await getCard(db, cardIds[0]!)).flag).toBe(1));
  await user.keyboard('{Control>}0{/Control}');
  await waitFor(async () => expect((await getCard(db, cardIds[0]!)).flag).toBe(0));
});

test('the flag menu offers the seven named colours', async () => {
  const { cardIds } = await seedNote(seedDeps, deck, 'basic', ['a', 'x']);
  const { user } = await study();
  await user.click(screen.getByRole('button', { name: 'Flag' }));
  expect(screen.getAllByRole('menuitem').map((m) => m.textContent?.replace(/Ctrl\+\d/, ''))).toEqual(
    ['Red', 'Orange', 'Green', 'Blue', 'Pink', 'Turquoise', 'Purple', 'Remove flag']);
  await user.click(screen.getByRole('menuitem', { name: /Blue/ }));
  await waitFor(async () => expect((await getCard(db, cardIds[0]!)).flag).toBe(4));
});

test('- buries and @ suspends, moving on each time', async () => {
  const a = (await seedNote(seedDeps, deck, 'basic', ['first', 'x'])).cardIds[0]!;
  const b = (await seedNote(seedDeps, deck, 'basic', ['second', 'x'])).cardIds[0]!;
  const { user } = await study();
  await waitFor(() => expect(card().textContent).toContain('first'));
  await user.keyboard('-');
  await waitFor(() => expect(card().textContent).toContain('second'));
  expect((await getCard(db, a)).buriedKind).toBe('manual');
  await user.keyboard('@');
  expect(await screen.findByRole('heading', { name: /Session complete|Nothing to study/ })).toBeTruthy();
  expect((await getCard(db, b)).suspended).toBe(true);
});

test('there is no triple-dot menu; burying still works from the keyboard', async () => {
  const a = (await seedNote(seedDeps, deck, 'basic', ['first', 'x'])).cardIds[0]!;
  const { user } = await study();
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  await user.keyboard('-');
  await waitFor(async () => expect((await getCard(db, a)).buriedKind).toBe('manual'));
});

test('E opens the overlay and Esc closes it without leaving Study', async () => {
  await seedNote(seedDeps, deck, 'basic', ['before', 'x']);
  const { user } = await study();
  await user.keyboard('e');
  expect(await screen.findByRole('dialog', { name: 'Edit card' })).toBeTruthy();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByTestId('study-card')).toBeTruthy();
});

test('the Edit card icon opens the overlay filled in with this card, with no deck button', async () => {
  await seedNote(seedDeps, deck, 'basic', ['before', 'after'], ['paper-1']);
  const { user } = await study();
  await user.click(screen.getByRole('button', { name: 'Edit card' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit card' });
  expect(await within(dialog).findByLabelText('Front')).toHaveProperty('value', 'before');
  expect(within(dialog).getByLabelText('Back')).toHaveProperty('value', 'after');
  const preview = await within(dialog).findByTestId('add-card-preview');
  await waitFor(() => expect(preview.querySelector('[data-cardview]')!.shadowRoot!.textContent).toContain('before'));
  expect(preview.querySelector('[data-cardview]')!.shadowRoot!.textContent).toContain('after');
  expect(within(dialog).getByRole('button', { name: 'Card type: Basic' })).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: /^Deck/ })).toBeNull();
});

test('Ctrl+Delete deletes after confirming and Ctrl+Z restores', async () => {
  await seedNote(seedDeps, deck, 'basic_reversed', ['dog', 'chien']);
  const { user } = await study();
  await user.keyboard('{Control>}{Delete}{/Control}');
  const dialog = await screen.findByRole('dialog', { name: 'Delete this note?' });
  expect(dialog.textContent).toContain('This deletes its 2 cards and their review history. Ctrl+Z brings it back.');
  await user.click(within(dialog).getByRole('button', { name: 'Delete note' }));
  await waitFor(async () => expect(await countRows(db, 'notes')).toBe(0));
  await user.keyboard('{Control>}z{/Control}');
  await waitFor(async () => expect(await countRows(db, 'notes')).toBe(1));
  await waitFor(() => expect(card().textContent).toContain('dog'));
});

test('I shows card info with unknown filters noted', async () => {
  const { noteId } = await seedNote(seedDeps, deck, 'basic', ['q', 'a']);
  const typeId = (await db.query<{ note_type_id: number }>(`SELECT note_type_id FROM notes WHERE id = ?`, [noteId]))[0]!.note_type_id;
  await db.execute(`UPDATE note_types SET templates = ? WHERE id = ?`, [JSON.stringify([{ name: 'Card 1', front: '{{foo:Front}}', back: '{{Back}}' }]), typeId]);
  const { user } = await study();
  await user.keyboard('i');
  const dialog = await screen.findByRole('dialog', { name: 'Card info' });
  expect(within(dialog).getByText('Reviews').nextSibling!.textContent).toBe('0');
  expect(within(dialog).getByText('Deck').nextSibling!.textContent).toBe('Chemistry');
  expect(dialog.textContent).toContain("This card's template uses filters Atlas doesn't know: foo. They show the raw field.");
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('a leech toast offers Edit', async () => {
  const id = (await seedNote(seedDeps, deck, 'basic', ['slippery', 'x'])).cardIds[0]!;
  await makeReview(db, id, { dueAt: T0 - DAY, lapses: 7 });
  const { user } = await study();
  await user.keyboard(' ');
  await screen.findByRole('button', { name: /^Again/ });
  await user.keyboard('1');
  const toast = await screen.findByText("This card keeps slipping, so it's been tagged as a leech and suspended.");
  expect(toast).toBeTruthy();
  await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Edit' }));
  expect(await screen.findByRole('dialog', { name: 'Edit card' })).toBeTruthy();
});
