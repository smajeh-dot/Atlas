// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Db } from '../../../src/data/db';
import { UndoStack } from '../../../src/services/undo';
import { createMigratedDb } from '../../helpers/testDb';
import { fixedClock, T0 } from '../../helpers/fixtures';
import { countRows, seedDeck, seedNote } from '../../helpers/seed';
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

async function cram() {
  const r = await renderApp({ db, route: { name: 'cram', deckId: deck } });
  await screen.findByTestId('cram-card');
  return r;
}

const shadow = () => document.querySelector('[data-testid="cram-card"] [data-cardview]')!.shadowRoot!;
const onScreen = () => document.querySelector('[data-testid="cram-card"] [data-cardview]') !== null;
const shown = () => shadow().querySelector('.atlas-question')?.textContent ?? '';
const answerText = () => shadow().querySelector('.atlas-answer')?.textContent ?? '';
const wrong = () => screen.getByRole('button', { name: /^Wrong/ }) as HTMLButtonElement;
const right = () => screen.getByRole('button', { name: /^Right/ }) as HTMLButtonElement;
const bar = () => screen.getByRole('progressbar');
const left = () => screen.getByTestId('cram-left').textContent;
const flipped = () => onScreen() && shadow().querySelector('.atlas-divider') !== null;

test('the question shows and Wrong and Right are disabled before the flip', async () => {
  await seedNote(seedDeps, deck, 'basic', ['What is a mole?', '6.02 × 10²³ particles']);
  await cram();
  await waitFor(() => expect(shown()).toContain('What is a mole?'));
  expect(wrong().disabled).toBe(true);
  expect(right().disabled).toBe(true);
});

test('Space flips and flips back; the buttons are enabled while flipped', async () => {
  await seedNote(seedDeps, deck, 'basic', ['What is a mole?', '6.02 × 10²³ particles']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).toContain('What is a mole?'));
  await user.keyboard(' ');
  await waitFor(() => expect(flipped()).toBe(true));
  expect(shadow().querySelector('.atlas-answer')!.textContent).toBe('6.02 × 10²³ particles');
  expect(wrong().disabled).toBe(false);
  expect(right().disabled).toBe(false);
  await user.keyboard(' ');
  await waitFor(() => expect(flipped()).toBe(false));
  expect(right().disabled).toBe(true);
});

test('clicking the card flips it', async () => {
  await seedNote(seedDeps, deck, 'basic', ['q', 'a']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).toContain('q'));
  await user.click(screen.getByTestId('cram-card'));
  await waitFor(() => expect(flipped()).toBe(true));
  await user.click(screen.getByTestId('cram-card'));
  await waitFor(() => expect(flipped()).toBe(false));
});

test('ArrowRight does nothing before the flip, then answers Right and shows the next card unflipped', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['two', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  const first = shown();
  await user.keyboard('{ArrowRight}');
  expect(left()).toBe('2 left');
  expect(shown()).toBe(first);
  await user.keyboard(' ');
  await waitFor(() => expect(flipped()).toBe(true));
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(left()).toBe('1 left'));
  await waitFor(() => expect(shown()).not.toBe(first));
  expect(flipped()).toBe(false);
});

test('ArrowLeft answers Wrong and that card comes back after the other one', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['two', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  const first = shown();
  await user.keyboard(' ');
  await waitFor(() => expect(flipped()).toBe(true));
  await user.keyboard('{ArrowLeft}');
  await waitFor(() => expect(shown()).not.toBe(first));
  expect(left()).toBe('2 left');
  const second = shown();
  await user.keyboard(' ');
  await waitFor(() => expect(flipped()).toBe(true));
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(shown()).toBe(first));
  expect(second).not.toBe(first);
  expect(left()).toBe('1 left');
});

test('the Wrong and Right buttons answer like the arrows and show their key hints', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['two', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  expect(wrong().textContent).toContain('←');
  expect(wrong().getAttribute('aria-keyshortcuts')).toBe('ArrowLeft');
  expect(right().textContent).toContain('→');
  expect(right().getAttribute('aria-keyshortcuts')).toBe('ArrowRight');
  await user.click(screen.getByTestId('cram-card'));
  await waitFor(() => expect(right().disabled).toBe(false));
  await user.click(right());
  await waitFor(() => expect(left()).toBe('1 left'));
  await user.click(screen.getByTestId('cram-card'));
  await waitFor(() => expect(right().disabled).toBe(false));
  await user.click(wrong());
  await waitFor(() => expect(flipped()).toBe(false));
  expect(left()).toBe('1 left');
});

test('the count and the progress bar follow the answers', async () => {
  for (const q of ['a', 'b', 'c']) await seedNote(seedDeps, deck, 'basic', [q, 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  expect(left()).toBe('3 left');
  expect(bar().getAttribute('aria-valuemax')).toBe('3');
  expect(bar().getAttribute('aria-valuenow')).toBe('0');
  await user.keyboard(' ');
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(left()).toBe('2 left'));
  expect(bar().getAttribute('aria-valuenow')).toBe('1');
  // A wrong answer finishes nothing: the card goes back into the round.
  await user.keyboard(' ');
  await waitFor(() => expect(flipped()).toBe(true));
  await user.keyboard('{ArrowLeft}');
  await waitFor(() => expect(flipped()).toBe(false));
  expect(left()).toBe('2 left');
  expect(bar().getAttribute('aria-valuenow')).toBe('1');
});

test('finishing the round shows the counts and Go again starts round 2 with every card', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['two', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  await user.keyboard(' ');
  await waitFor(() => expect(flipped()).toBe(true));
  await user.keyboard('{ArrowLeft}');
  await waitFor(() => expect(flipped()).toBe(false));
  for (let i = 0; i < 2; i++) {
    await user.keyboard(' ');
    await waitFor(() => expect(flipped()).toBe(true));
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(flipped()).toBe(false));
  }
  await screen.findByText('Round complete');
  expect(screen.getByTestId('cram-result').textContent).toBe('2 right · 1 wrong');
  expect(screen.queryByTestId('cram-card')?.querySelector('[data-cardview]')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Go again' }));
  await waitFor(() => expect(left()).toBe('2 left'));
  expect(screen.queryByText('Round complete')).toBeNull();
  expect(bar().getAttribute('aria-valuenow')).toBe('0');
  expect(bar().getAttribute('aria-valuemax')).toBe('2');
});

test('type-in and cloze cards are plain flip cards with no text box', async () => {
  await seedNote(seedDeps, deck, 'basic_typein', ['Capital of France?', 'Paris']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).toContain('Capital of France?'));
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(document.querySelector('input')).toBeNull();
  await user.keyboard(' ');
  await waitFor(() => expect(flipped()).toBe(true));
  expect(shadow().querySelector('.atlas-typein-compare')).toBeNull();
  expect(answerText()).toBe('Paris');
  expect(wrong().disabled).toBe(false);
});

test('a cloze card shows as a flip card too', async () => {
  await seedNote(seedDeps, deck, 'cloze', ['The {{c1::mole}} counts particles', '']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).toContain('The'));
  expect(document.querySelector('input')).toBeNull();
  await user.keyboard(' ');
  await waitFor(() => expect(flipped()).toBe(true));
  expect(shown()).toContain('mole');
  expect(answerText()).toBe('');
});

test('global shortcuts are locked: A opens nothing, Ctrl+Z is the cram undo and never touches the revlog', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['two', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  await user.keyboard('a');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByTestId('cram-card')).toBeTruthy();
  const first = shown();
  await user.keyboard(' ');
  await waitFor(() => expect(flipped()).toBe(true));
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(shown()).not.toBe(first));
  await user.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(shown()).toBe(first));
  expect(flipped()).toBe(true);
  expect(left()).toBe('2 left');
  expect(screen.getByRole('status').textContent).toBe('');
  expect(await countRows(db, 'revlog')).toBe(0);
});

test('the Undo button takes back the last answer and is disabled with nothing to undo', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
  expect(undo.disabled).toBe(true);
  await user.keyboard(' ');
  await user.keyboard('{ArrowRight}');
  await screen.findByText('Round complete');
  expect(undo.disabled).toBe(false);
  await user.click(undo);
  await waitFor(() => expect(left()).toBe('1 left'));
  await waitFor(() => expect(flipped()).toBe(true));
});

test('Esc leaves to Today', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  const { user } = await cram();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByTestId('cram-card')).toBeNull());
});

test('the strip has a restart control, and no Edit, Flag or Bury buttons', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await cram();
  expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy();
  const names = [...document.querySelectorAll('button, [role=button]')].map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
  expect(names.filter((n) => /edit|flag|bury/i.test(n))).toEqual([]);
});
