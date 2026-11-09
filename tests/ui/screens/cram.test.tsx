// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Db } from '../../../src/data/db';
import { CramSession, cramKey } from '../../../src/services/cramSession';
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

test('the strip buttons draw real icons (back, undo, restart), not the dashed placeholder', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await cram();
  for (const [name, icon] of [['Leave cram', 'back'], ['Undo', 'undo'], ['Restart', 'reset']] as const) {
    const button = screen.getByRole('button', { name });
    expect(button.querySelector(`svg[data-icon="${icon}"] path`), name).not.toBeNull();
    expect(button.querySelector('[data-placeholder="true"]'), name).toBeNull();
  }
});

test('the strip has a restart control, and no Edit, Flag or Bury buttons', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await cram();
  expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy();
  const names = [...document.querySelectorAll('button, [role=button]')].map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
  expect(names.filter((n) => /edit|flag|bury/i.test(n))).toEqual([]);
});

const restartDialog = () => screen.getByRole('dialog', { name: 'Restart this round?' });
const reveal = async (user: Awaited<ReturnType<typeof cram>>['user']) => {
  await user.keyboard(' ');
  await waitFor(() => expect(flipped()).toBe(true));
};
const savedRound = async () => {
  const [row] = await db.query<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [cramKey(deck)]);
  return row ? (JSON.parse(String(row.value)) as { round: number; queue: number[] }) : null;
};

test('an empty deck shows the empty state, and Back goes Home', async () => {
  const { user } = await renderApp({ db, route: { name: 'cram', deckId: deck } });
  expect(await screen.findByRole('heading', { name: 'No cards to cram in this deck' })).toBeTruthy();
  expect(screen.queryByTestId('cram-card')).toBeNull();
  await user.click(screen.getByRole('button', { name: /^Back to Home/ }));
  expect(await screen.findByTestId('today-screen')).toBeTruthy();
});

test('a deck whose only card is suspended is empty too, and Esc leaves from the empty screen', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await db.execute(`UPDATE cards SET suspended = 1`);
  const { user } = await renderApp({ db, route: { name: 'cram', deckId: deck } });
  await screen.findByRole('heading', { name: 'No cards to cram in this deck' });
  await user.keyboard('{Escape}');
  expect(await screen.findByTestId('today-screen')).toBeTruthy();
});

test('Esc leaves mid-round with no dialog, and reopening resumes at the same card', async () => {
  for (const q of ['a', 'b', 'c']) await seedNote(seedDeps, deck, 'basic', [q, 'x']);
  const first = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  await reveal(first.user);
  await first.user.keyboard('{ArrowRight}');
  await waitFor(() => expect(left()).toBe('2 left'));
  const card = shown();
  await first.user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await screen.findByTestId('today-screen')).toBeTruthy();
  first.unmount();
  await cram();
  await waitFor(() => expect(left()).toBe('2 left'));
  expect(shown()).toBe(card);
});

test('Restart opens a dialog; Keep going leaves the round alone', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['two', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  await reveal(user);
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(left()).toBe('1 left'));
  await user.click(screen.getByRole('button', { name: 'Restart' }));
  expect(restartDialog()).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Keep going' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(left()).toBe('1 left');
  // Esc inside the dialog closes only the dialog.
  await user.click(screen.getByRole('button', { name: 'Restart' }));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByTestId('cram-card')).toBeTruthy();
  expect(left()).toBe('1 left');
});

test('confirming Restart starts round 1 with every card', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  await reveal(user);
  await user.keyboard('{ArrowRight}');
  await user.click(await screen.findByRole('button', { name: 'Go again' }));
  await waitFor(() => expect(left()).toBe('1 left'));
  expect((await savedRound())?.round).toBe(2);
  await user.click(screen.getByRole('button', { name: 'Restart' }));
  await user.click(screen.getByRole('button', { name: 'Restart round' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(left()).toBe('1 left');
  expect(bar().getAttribute('aria-valuenow')).toBe('0');
  expect(flipped()).toBe(false);
  expect((await savedRound())?.round).toBe(1);
});

test('Restart works from a finished round', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  await reveal(user);
  await user.keyboard('{ArrowRight}');
  await screen.findByText('Round complete');
  await user.click(screen.getByRole('button', { name: 'Restart' }));
  await user.click(screen.getByRole('button', { name: 'Restart round' }));
  await waitFor(() => expect(screen.queryByText('Round complete')).toBeNull());
  expect(left()).toBe('1 left');
});

/** Two clicks before React gets to re-render, as a fast double click can deliver them. */
const twice = (el: HTMLElement) => {
  for (let i = 0; i < 2; i++) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};

test('double-clicking Restart round and Go again each restart only once', async () => {
  const restart = vi.spyOn(CramSession.prototype, 'restart');
  const goAgain = vi.spyOn(CramSession.prototype, 'goAgain');
  try {
    await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
    const { user } = await cram();
    await waitFor(() => expect(shown()).not.toBe(''));
    await reveal(user);
    await user.keyboard('{ArrowRight}');
    twice(await screen.findByRole('button', { name: 'Go again' }));
    await waitFor(() => expect(screen.queryByText('Round complete')).toBeNull());
    expect(goAgain).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Restart' }));
    twice(screen.getByRole('button', { name: 'Restart round' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(restart).toHaveBeenCalledTimes(1);
  } finally {
    restart.mockRestore();
    goAgain.mockRestore();
  }
});

test('Ctrl+Z with nothing to undo does nothing: no app-wide undo, no toast', async () => {
  const { undoEntry } = await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['two', 'x']);
  const { user, deps } = await cram();
  deps.undo.push(undoEntry);
  await waitFor(() => expect(shown()).not.toBe(''));
  const card = shown();
  const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
  expect(undo.disabled).toBe(true);
  await user.keyboard('{Control>}z{/Control}');
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.getByRole('status').textContent).toBe('');
  expect(deps.undo.size).toBe(1);
  expect(await countRows(db, 'notes')).toBe(2);
  expect(shown()).toBe(card);
  expect(flipped()).toBe(false);
  expect(left()).toBe('2 left');
});

test('Space on a focused Wrong, Right or Undo button is left to the button and does not flip the card', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['two', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['three', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  await reveal(user);
  for (const button of [right, wrong]) {
    button().focus();
    await user.keyboard('[Space>]');
    expect(flipped()).toBe(true);
    await user.keyboard('[/Space]');
    await waitFor(() => expect(flipped()).toBe(false));
    await reveal(user);
  }
  // Right and Wrong above each answered one card; the last Space released on a button is its click.
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(flipped()).toBe(false));
  const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
  expect(undo.disabled).toBe(false);
  undo.focus();
  await user.keyboard('[Space>]');
  expect(flipped()).toBe(false);
  await user.keyboard('[/Space]');
  await waitFor(() => expect(flipped()).toBe(true));
});

test('a failed read during an answer shows a toast, frees the screen, and the next answer works', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['two', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  const first = shown();
  await reveal(user);
  const query = db.query.bind(db);
  db.query = vi.fn().mockRejectedValueOnce(new Error('disk I/O error')).mockImplementation(query) as Db['query'];
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain("Atlas couldn't update this round"));
  expect(left()).toBe('2 left');
  expect(shown()).toBe(first);
  expect(flipped()).toBe(true);
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(left()).toBe('1 left'));
  expect(shown()).not.toBe(first);
});

test('rapid double ArrowRight answers one card only', async () => {
  for (const q of ['a', 'b', 'c']) await seedNote(seedDeps, deck, 'basic', [q, 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  await reveal(user);
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  await waitFor(() => expect(left()).toBe('2 left'));
  await new Promise((r) => setTimeout(r, 20));
  expect(left()).toBe('2 left');
  expect(bar().getAttribute('aria-valuenow')).toBe('1');
});

test('when the round cannot be saved a toast says so and the study loop carries on', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['two', 'x']);
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  const execute = db.execute.bind(db);
  db.execute = vi.fn(async (sql: string, params?: unknown[]) => {
    if (/\bmeta\b/.test(sql)) throw new Error('database is locked');
    return execute(sql, params);
  }) as Db['execute'];
  await reveal(user);
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe("Atlas couldn't save your cram round, but you can keep going"));
  expect(left()).toBe('1 left');
  await reveal(user);
  await user.keyboard('{ArrowRight}');
  await screen.findByText('Round complete');
});

test('a plain Right and a plain Wrong never write cards, notes or revlog', async () => {
  await seedNote(seedDeps, deck, 'basic', ['one', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['two', 'x']);
  const snapshot = async () => JSON.stringify([
    await db.query(`SELECT * FROM cards ORDER BY id`),
    await db.query(`SELECT * FROM notes ORDER BY id`),
    await db.query(`SELECT * FROM revlog ORDER BY id`),
  ]);
  const before = await snapshot();
  const { user } = await cram();
  await waitFor(() => expect(shown()).not.toBe(''));
  await reveal(user);
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(left()).toBe('1 left'));
  await reveal(user);
  await user.keyboard('{ArrowLeft}');
  await waitFor(() => expect(bar().getAttribute('aria-valuenow')).toBe('1'));
  expect(await snapshot()).toBe(before);
  expect(await savedRound()).not.toBeNull();
});
