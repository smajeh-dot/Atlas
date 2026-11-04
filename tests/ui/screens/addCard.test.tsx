// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Db } from '../../../src/data/db';
import { getSettings } from '../../../src/data/settings';
import { UndoStack } from '../../../src/services/undo';
import { createMigratedDb } from '../../helpers/testDb';
import { fixedClock, T0 } from '../../helpers/fixtures';
import { countRows, seedDeck, seedNote } from '../../helpers/seed';
import { renderApp } from '../../helpers/renderApp';

vi.mock('../../../src/ui/editor/FieldEditor', () => import('../../helpers/fieldEditorStub'));

let db: Db;
let deck: number;
beforeEach(async () => {
  db = await createMigratedDb();
  const bio = await seedDeck(db, 'Biology');
  deck = await seedDeck(db, 'Genetics & Inheritance', bio);
});

async function open(deckId: number | undefined = deck) {
  const r = await renderApp({ db, route: { name: 'add', deckId } });
  await screen.findByLabelText('Front');
  return r;
}

const preview = () => document.querySelector('[data-testid="preview"] [data-cardview]')!.shadowRoot!;

test('Ctrl+Enter adds a Basic card, clears fields and offers Undo', async () => {
  const { user } = await open();
  await user.type(screen.getByLabelText('Front'), 'What is a gene?');
  await user.type(screen.getByLabelText('Back'), 'A unit of heredity');
  await user.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(async () => expect(await countRows(db, 'notes')).toBe(1));
  expect(screen.getByLabelText('Front')).toHaveProperty('value', '');
  expect(screen.getByLabelText('Back')).toHaveProperty('value', '');
  expect(document.activeElement).toBe(screen.getByLabelText('Front'));
  expect(screen.getByRole('status').textContent).toContain('Added to Genetics & Inheritance');
  expect(screen.getByText('1 card added this session')).toBeTruthy();
  await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
  await waitFor(async () => expect(await countRows(db, 'notes')).toBe(0));
});

test('the Add card button adds too, and the deck is shown with its full name', async () => {
  const { user } = await open();
  expect(screen.getByRole('button', { name: /^Deck / }).textContent).toContain('Biology › Genetics & Inheritance');
  await user.type(screen.getByLabelText('Front'), 'Q');
  await user.click(within(screen.getByRole('group', { name: 'Note actions' })).getByRole('button', { name: 'Add card' }));
  await waitFor(async () => expect(await countRows(db, 'cards')).toBe(1));
});

test('Basic and reversed makes two cards and the preview offers Card 1 | Card 2', async () => {
  const { user } = await open();
  await user.click(screen.getByRole('button', { name: /^Type/ }));
  await user.click(screen.getByRole('option', { name: 'Basic and reversed' }));
  await user.type(screen.getByLabelText('Front'), 'dog');
  await user.type(screen.getByLabelText('Back'), 'chien');
  await user.click(screen.getByRole('radio', { name: 'Card 2' }));
  await waitFor(() => expect(preview().textContent).toContain('chien'));
  await user.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(async () => expect(await countRows(db, 'cards')).toBe(2));
  expect(screen.getByText('2 cards added this session')).toBeTruthy();
});

test('a cloze note with no cloze shows the reason and is not added', async () => {
  const { user } = await open();
  await user.click(screen.getByRole('button', { name: /^Type/ }));
  await user.click(screen.getByRole('option', { name: 'Cloze' }));
  expect(screen.getByText('Select text and press Ctrl+Shift+C to hide it. Ctrl+Alt+Shift+C hides it in the same card as the last one.')).toBeTruthy();
  await user.type(screen.getByLabelText('Text'), 'no cloze here');
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(await screen.findByText('This note would not make any cards. Fill in the first field, or add a cloze.')).toBeTruthy();
  expect(await countRows(db, 'notes')).toBe(0);
});

test('cloze preview offers c1 | c2', async () => {
  const { user } = await open();
  await user.click(screen.getByRole('button', { name: /^Type/ }));
  await user.click(screen.getByRole('option', { name: 'Cloze' }));
  await user.type(screen.getByLabelText('Text'), 'The {{{{c1::nucleus}} holds {{{{c2::DNA}}');
  expect(screen.getByRole('radio', { name: 'c1' })).toBeTruthy();
  await user.click(screen.getByRole('radio', { name: 'c2' }));
  await waitFor(() => expect(preview().textContent).toContain('The nucleus holds […]'));
});

test('the preview renders the card as Study will', async () => {
  const { user } = await open();
  await user.type(screen.getByLabelText('Front'), 'H\\(_2\\)O');
  await waitFor(() => expect(preview().querySelector('.katex')).not.toBeNull());
  await user.click(screen.getByRole('radio', { name: 'Back' }));
  await waitFor(() => expect(preview().querySelector('.atlas-divider')).not.toBeNull());
});

test('possible duplicates are flagged after typing stops', async () => {
  const deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  const cells = await seedDeck(db, 'Cells', (await db.query<{ id: number }>(`SELECT id FROM decks WHERE name = 'Biology'`))[0]!.id);
  await seedNote(deps, cells, 'basic', ['Osmosis', 'x']);
  const { user } = await open();
  await user.type(screen.getByLabelText('Front'), 'osmosis');
  expect(await screen.findByText('Possible duplicate in Biology › Cells')).toBeTruthy();
  await user.clear(screen.getByLabelText('Front'));
  await user.type(screen.getByLabelText('Front'), 'unique');
  expect(await screen.findByText('No duplicates in this deck')).toBeTruthy();
});

test('type and deck are remembered', async () => {
  const chem = await seedDeck(db, 'Chemistry');
  const { user, unmount } = await open(undefined);
  await user.click(screen.getByRole('button', { name: /^Type/ }));
  await user.click(screen.getByRole('option', { name: 'Cloze' }));
  await user.click(screen.getByRole('button', { name: /^Deck / }));
  await user.keyboard('chem{Enter}');
  await waitFor(async () => expect((await getSettings(db)).lastDeckId).toBe(chem));
  const s = await getSettings(db);
  expect(s.lastNoteTypeId).toBe((await db.query<{ id: number }>(`SELECT id FROM note_types WHERE builtin = 'cloze'`))[0]!.id);
  unmount();
  await renderApp({ db, route: { name: 'add' } });
  expect(await screen.findByLabelText('Text')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Deck / }).textContent).toContain('Chemistry');
});

test('tags are kept after adding', async () => {
  const { user } = await open();
  await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'paper-1{Enter}');
  await user.type(screen.getByLabelText('Front'), 'Q');
  await user.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(async () => expect(await countRows(db, 'notes')).toBe(1));
  const [n] = await db.query<{ tags: string }>('SELECT tags FROM notes');
  expect(n!.tags).toBe(' paper-1 ');
  expect(screen.getByText('paper-1')).toBeTruthy();
});

test('a failed save keeps the fields and says why', async () => {
  const { user, deps } = await open();
  const batch = deps.db.batch.bind(deps.db);
  deps.db.batch = vi.fn().mockRejectedValueOnce(new Error('disk I/O error')).mockImplementation(batch);
  await user.type(screen.getByLabelText('Front'), 'Keep me');
  await user.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain("Atlas couldn't save that card: disk I/O error"));
  expect(screen.getByLabelText('Front')).toHaveProperty('value', 'Keep me');
  act(() => {});
});

test("the toast's Undo confirms what it undid", async () => {
  const { user } = await open();
  await user.type(screen.getByLabelText('Front'), 'one');
  await user.keyboard('{Control>}{Enter}{/Control}');
  await user.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Undid: add card'));
  expect(screen.queryByText(/added this session/)).toBeNull();
});

test('the Back preview of a type-the-answer card shows the correct answer', async () => {
  const { user } = await open();
  await user.click(screen.getByRole('button', { name: /^Type/ }));
  await user.click(screen.getByRole('option', { name: 'Type the answer' }));
  await user.type(screen.getByLabelText('Front'), 'Capital of France?');
  await user.type(screen.getByLabelText('Back'), 'Paris');
  await user.click(screen.getByRole('radio', { name: 'Back' }));
  await waitFor(() => expect(preview().querySelector('.atlas-typein-answer')?.textContent).toBe('Paris'));
});
