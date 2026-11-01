// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { listDecks } from '../../../src/data/decks';
import { getSettings } from '../../../src/data/settings';
import { renderApp } from '../../helpers/renderApp';

test('Welcome explains Atlas and offers the two looks', async () => {
  await renderApp();
  expect(await screen.findByRole('heading', { name: 'Welcome to Atlas' })).toBeTruthy();
  expect(screen.getByText("Atlas shows you each flashcard just before you'd forget it, so you remember more with less revision.")).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByRole('button', { name: /Import from Anki/ })).toBeNull();
});

test('picking Tangerine restyles instantly and is remembered', async () => {
  const { user, db } = await renderApp();
  await user.click(await screen.findByRole('radio', { name: 'Tangerine' }));
  expect(document.documentElement.dataset.theme).toBe('tangerine');
  await waitFor(async () => expect((await getSettings(db)).theme).toBe('tangerine'));
  expect(screen.getByRole('radio', { name: 'Tangerine' }).getAttribute('aria-checked')).toBe('true');
});

test('Start from scratch creates the deck and opens Add card on it', async () => {
  const { user, db } = await renderApp();
  await user.click(await screen.findByRole('button', { name: 'Start from scratch' }));
  const input = screen.getByLabelText('Deck name') as HTMLInputElement;
  expect(input.value).toBe('My first deck');
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('heading', { name: 'Add card' })).toBeTruthy();
  expect((await listDecks(db)).map((d) => d.name)).toEqual(['My first deck']);
  expect((await getSettings(db)).lastDeckId).toBe((await listDecks(db))[0]!.id);
});

test('an empty deck name shows the error', async () => {
  const { user } = await renderApp();
  await user.click(await screen.findByRole('button', { name: 'Start from scratch' }));
  await user.clear(screen.getByLabelText('Deck name'));
  await user.keyboard('{Enter}');
  expect((await screen.findByRole('alert')).textContent).toBe('Give the deck a name.');
});
