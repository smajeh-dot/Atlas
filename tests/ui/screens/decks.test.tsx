// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import type { Db } from '../../../src/data/db';
import { listDecks } from '../../../src/data/decks';
import { UndoStack } from '../../../src/services/undo';
import { createMigratedDb } from '../../helpers/testDb';
import { DAY, fixedClock, T0 } from '../../helpers/fixtures';
import { makeReview, seedDeck, seedNote } from '../../helpers/seed';
import { renderApp } from '../../helpers/renderApp';

let db: Db;
beforeEach(async () => {
  db = await createMigratedDb();
});

const order = async (parentId: number | null = null) =>
  (await listDecks(db)).filter((d) => d.parentId === parentId).sort((a, b) => a.position - b.position).map((d) => d.name);

async function openDecks(deckId?: number) {
  const r = await renderApp({ db, route: { name: 'decks', deckId } });
  const tree = await screen.findByRole('tree', { name: 'All decks' });
  await waitFor(() => expect(within(tree).getAllByRole('treeitem').length).toBeGreaterThan(0));
  return { ...r, tree };
}

test('New deck creates a top-level deck', async () => {
  await seedDeck(db, 'Biology');
  const { user, tree } = await openDecks();
  await user.click(screen.getByRole('button', { name: 'New deck' }));
  await user.type(screen.getByLabelText('Deck name'), 'Physics{Enter}');
  expect(await within(tree).findByRole('treeitem', { name: /^Physics/ })).toBeTruthy();
  expect(await order()).toEqual(['Biology', 'Physics']);
});

test('Alt+↓ moves a deck below its next sibling; Alt+→ nests it; Alt+← moves it out', async () => {
  const a = await seedDeck(db, 'A');
  await seedDeck(db, 'B');
  await seedDeck(db, 'C');
  const { user, tree } = await openDecks(a);
  tree.focus();
  await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
  await waitFor(async () => expect(await order()).toEqual(['B', 'A', 'C']));
  await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
  const b = (await listDecks(db)).find((d) => d.name === 'B')!.id;
  await waitFor(async () => expect(await order(b)).toEqual(['A']));
  await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
  await waitFor(async () => expect(await order()).toEqual(['B', 'A', 'C']));
});

test('F2 renames inline; a clash shows the error and keeps editing', async () => {
  const chem = await seedDeck(db, 'Chemistry');
  await seedDeck(db, 'Biology');
  const { user, tree } = await openDecks(chem);
  tree.focus();
  await user.keyboard('{F2}');
  const input = within(tree).getByLabelText('Deck name');
  await user.clear(input);
  await user.type(input, 'biology{Enter}');
  expect((await within(tree).findByRole('alert')).textContent).toBe('There is already a deck called "biology" here.');
  await user.clear(input);
  await user.type(input, 'Chem{Enter}');
  await waitFor(() => expect(within(tree).queryByLabelText('Deck name')).toBeNull());
  expect((await listDecks(db)).find((d) => d.id === chem)!.name).toBe('Chem');
});

test('Esc cancels an inline rename', async () => {
  const chem = await seedDeck(db, 'Chemistry');
  const { user, tree } = await openDecks(chem);
  tree.focus();
  await user.keyboard('{F2}');
  await user.type(within(tree).getByLabelText('Deck name'), 'xyz{Escape}');
  await waitFor(() => expect(within(tree).queryByLabelText('Deck name')).toBeNull());
  expect((await listDecks(db))[0]!.name).toBe('Chemistry');
});

test('dropping on the middle of a row nests the dragged deck', async () => {
  await seedDeck(db, 'A');
  await seedDeck(db, 'B');
  const { tree } = await openDecks();
  const rowA = within(tree).getByRole('treeitem', { name: /^A,/ });
  const rowB = within(tree).getByRole('treeitem', { name: /^B,/ });
  rowA.getBoundingClientRect = () => ({ top: 0, height: 33, bottom: 33, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON() {} });
  fireEvent.dragStart(rowB);
  fireEvent.dragOver(rowA, { clientY: 16 });
  fireEvent.drop(rowA, { clientY: 16 });
  const a = (await listDecks(db)).find((d) => d.name === 'A')!.id;
  await waitFor(async () => expect(await order(a)).toEqual(['B']));
});

test('dropping on the top third of a row places the deck before it', async () => {
  await seedDeck(db, 'A');
  await seedDeck(db, 'B');
  const { tree } = await openDecks();
  const rowA = within(tree).getByRole('treeitem', { name: /^A,/ });
  rowA.getBoundingClientRect = () => ({ top: 0, height: 33, bottom: 33, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON() {} });
  fireEvent.dragStart(within(tree).getByRole('treeitem', { name: /^B,/ }));
  fireEvent.dragOver(rowA, { clientY: 3 });
  fireEvent.drop(rowA, { clientY: 3 });
  await waitFor(async () => expect(await order()).toEqual(['B', 'A']));
});

test('summary counts for the selected deck', async () => {
  const deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  const bio = await seedDeck(db, 'Biology');
  await seedNote(deps, bio, 'basic', ['a', 'x']);
  await makeReview(db, (await seedNote(deps, bio, 'basic', ['b', 'x'])).cardIds[0]!, { dueAt: T0 + DAY, scheduledDays: 30 });
  await openDecks(bio);
  const summary = await screen.findByRole('region', { name: 'Cards in Biology' });
  await waitFor(() => expect(within(summary).getByText('Total cards').nextSibling!.textContent).toBe('2'));
  expect(within(summary).getByText('New').nextSibling!.textContent).toBe('1');
  expect(within(summary).getByText('Mature').nextSibling!.textContent).toBe('1');
});
