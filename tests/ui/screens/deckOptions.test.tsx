// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Db } from '../../../src/data/db';
import { listDecks } from '../../../src/data/decks';
import { getPreset, listPresets } from '../../../src/data/presets';
import { createMigratedDb } from '../../helpers/testDb';
import { seedDeck } from '../../helpers/seed';
import { renderApp } from '../../helpers/renderApp';

let db: Db;
let deck: number;
beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  db = await createMigratedDb();
  deck = await seedDeck(db, 'Biology');
});
afterEach(() => vi.useRealTimers());

async function open() {
  const r = await renderApp({ db, route: { name: 'decks', deckId: deck }, fakeTimers: true });
  await screen.findByRole('region', { name: 'Deck options' });
  return r;
}

test('changing new cards per day saves after 500 ms with a Saved toast', async () => {
  const { user } = await open();
  const input = screen.getByLabelText('New cards per day');
  await user.clear(input);
  await user.type(input, '30');
  expect((await getPreset(db, 1)).config.newPerDay).toBe(20);
  await act(async () => vi.advanceTimersByTime(600));
  await waitFor(async () => expect((await getPreset(db, 1)).config.newPerDay).toBe(30));
  expect(screen.getByRole('status').textContent).toContain('Saved');
});

test('invalid learning steps show the error and are not saved', async () => {
  const { user } = await open();
  const input = screen.getByLabelText('Learning steps');
  await user.clear(input);
  await user.type(input, '1m ten');
  expect(screen.getByText('Use numbers followed by m, h or d, like 1m 10m.')).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(600));
  expect((await getPreset(db, 1)).config.learningSteps).toEqual(['1m', '10m']);
  await user.clear(input);
  await user.type(input, '2m 15m');
  await act(async () => vi.advanceTimersByTime(600));
  await waitFor(async () => expect((await getPreset(db, 1)).config.learningSteps).toEqual(['2m', '15m']));
});

test('retention slider shows the live explanation and saves', async () => {
  await open();
  expect(screen.getByText("At 90%, you'll remember about 9 in 10 cards when they come up. Higher means more reviews each day.")).toBeTruthy();
  fireEvent.change(screen.getByRole('slider', { name: 'Desired retention' }), { target: { value: '0.8' } });
  expect(screen.getByText("At 80%, you'll remember about 8 in 10 cards when they come up. Higher means more reviews each day.")).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(600));
  await waitFor(async () => expect((await getPreset(db, 1)).config.desiredRetention).toBe(0.8));
});

test('maximum interval is explained in years', async () => {
  await open();
  expect(screen.getByText('100 years')).toBeTruthy();
});

test('toggles and segmented choices save', async () => {
  const { user } = await open();
  await user.click(screen.getByRole('switch', { name: "Hide a new card's siblings until tomorrow" }));
  await user.click(screen.getByRole('radio', { name: 'Tag only' }));
  await user.click(screen.getByRole('radio', { name: 'Random' }));
  await act(async () => vi.advanceTimersByTime(600));
  await waitFor(async () => expect((await getPreset(db, 1)).config).toMatchObject({ buryNewSiblings: false, leechAction: 'tag', newCardOrder: 'random' }));
});

test('Save as new preset assigns it to this deck', async () => {
  const { user } = await open();
  expect(screen.getByText('Used by 1 deck')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Preset options' }));
  await user.click(screen.getByRole('menuitem', { name: 'Save as new preset' }));
  const name = screen.getByLabelText('Preset name');
  await user.clear(name);
  await user.type(name, 'Exam cram{Enter}');
  await waitFor(async () => expect((await listPresets(db)).map((p) => p.name)).toEqual(['Default', 'Exam cram']));
  const cram = (await listPresets(db))[1]!.id;
  await waitFor(async () => expect((await listDecks(db))[0]!.presetId).toBe(cram));
  expect(await within(screen.getByRole('region', { name: 'Deck options' })).findByRole('button', { name: 'Preset Exam cram' })).toBeTruthy();
});

test('Delete is disabled for a preset in use, with the reason', async () => {
  const { user } = await open();
  await user.click(screen.getByRole('button', { name: 'Preset options' }));
  const del = screen.getByRole('menuitem', { name: /Delete/ });
  expect(del.getAttribute('aria-disabled')).toBe('true');
  expect(del.textContent).toContain('Move every deck to another preset first.');
});
