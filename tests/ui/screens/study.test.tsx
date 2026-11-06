// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { formatInterval } from '../../../src/core/format';
import type { Db } from '../../../src/data/db';
import { getCard } from '../../../src/data/cards';
import { updateSettings } from '../../../src/data/settings';
import { StudySession } from '../../../src/services/studySession';
import { UndoStack } from '../../../src/services/undo';
import { createMigratedDb } from '../../helpers/testDb';
import { fixedClock, MIN, T0 } from '../../helpers/fixtures';
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
afterEach(() => vi.useRealTimers());

async function study(opts: { clock?: ReturnType<typeof fixedClock>; fakeTimers?: boolean; deckId?: number | null } = {}) {
  const r = await renderApp({ db, clock: opts.clock, fakeTimers: opts.fakeTimers, route: { name: 'study', deckId: opts.deckId === undefined ? deck : opts.deckId } });
  await screen.findByRole('button', { name: 'Leave study' });
  return r;
}

const card = () => document.querySelector('[data-testid="study-card"] [data-cardview]')!.shadowRoot!;

test('Space reveals, buttons show the intervals the session will give, 3 grades this card', async () => {
  await seedNote(seedDeps, deck, 'basic', ['What is a mole?', '6.02 × 10²³ particles']);
  const { user, deps } = await study();
  const probe = await StudySession.start({ ...deps, undo: new UndoStack() }, deck);
  const expected = probe.current()!.previews;
  expect(await screen.findByTestId('study-card')).toBeTruthy();
  await waitFor(() => expect(card().textContent).toContain('What is a mole?'));
  await user.keyboard(' ');
  await waitFor(() => expect(card().querySelector('.atlas-divider')).not.toBeNull());
  expect(card().querySelector('.atlas-answer')!.textContent).toBe('6.02 × 10²³ particles');
  expect(screen.getByRole('button', { name: /^Again/ }).textContent).toBe(`1Again${formatInterval(expected[1])}`);
  expect(screen.getByRole('button', { name: /^Hard/ }).textContent).toBe(`2Hard${formatInterval(expected[2])}`);
  expect(screen.getByRole('button', { name: /^Good/ }).textContent).toBe(`3Good${formatInterval(expected[3])}`);
  expect(screen.getByRole('button', { name: /^Easy/ }).textContent).toBe(`4Easy${formatInterval(expected[4])}`);
  await user.keyboard('3');
  await waitFor(async () => expect(await countRows(db, 'revlog')).toBe(1));
  const [log] = await db.query<{ card_id: number; rating: number }>('SELECT card_id, rating FROM revlog');
  expect(log).toEqual({ card_id: probe.current()!.card.id, rating: 3 });
});

test('shows the breadcrumb and progress, with no tag chips, hint line or Show answer button', async () => {
  const org = await seedDeck(db, 'Organic Mechanisms', deck);
  await seedNote(seedDeps, org, 'basic', ['q1', 'a'], ['paper-1', 'organic', 'third']);
  await seedNote(seedDeps, org, 'basic', ['q2', 'a']);
  await study();
  const top = await screen.findByRole('navigation', { name: 'Breadcrumb' });
  expect(top.textContent).toBe('Chemistry›Organic Mechanisms');
  expect(screen.queryByTestId('study-chips')).toBeNull();
  expect(screen.queryByText('paper-1')).toBeNull();
  expect(screen.getByText('2 left')).toBeTruthy();
  expect(screen.queryByText(/Space = Good/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Show answer' })).toBeNull();
});

test('grade keys do nothing before the answer is shown; a fast double press grades once', async () => {
  await seedNote(seedDeps, deck, 'basic', ['a', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['b', 'x']);
  const { user } = await study();
  await screen.findByTestId('study-card');
  await user.keyboard('3');
  expect(await countRows(db, 'revlog')).toBe(0);
  await user.keyboard(' ');
  await screen.findByRole('button', { name: /^Good/ });
  await user.keyboard('33');
  await waitFor(async () => expect(await countRows(db, 'revlog')).toBe(1));
  expect(await screen.findByTestId('study-card')).toBeTruthy();
});

test('Ctrl+Z undoes the answer and shows the same card again', async () => {
  await seedNote(seedDeps, deck, 'basic', ['first', 'x']);
  await seedNote(seedDeps, deck, 'basic', ['second', 'x']);
  const { user } = await study();
  await waitFor(() => expect(card().textContent).toContain('first'));
  await user.keyboard(' ');
  await screen.findByRole('button', { name: /^Good/ });
  await user.keyboard(' ');
  await waitFor(() => expect(card().textContent).toContain('second'));
  await user.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Undid: answer Good'));
  await waitFor(() => expect(card().textContent).toContain('first'));
  expect(await countRows(db, 'revlog')).toBe(0);
  expect(screen.getByTestId('study-card')).toBeTruthy();
});

test('type the answer compares character by character', async () => {
  await seedNote(seedDeps, deck, 'basic_typein', ['Capital of France?', 'Paris']);
  const { user } = await study();
  const input = await screen.findByPlaceholderText('Type your answer, then press Enter');
  expect(document.activeElement).toBe(input);
  await user.type(input, 'Parjs{Enter}');
  await waitFor(() => expect(card().querySelector('.atlas-typein-compare')).not.toBeNull());
  const compare = card().querySelector('.atlas-typein-compare')!;
  expect(compare.querySelector('.ok')!.textContent).toBe('Par');
  expect(compare.querySelector('.wrong')!.textContent).toBe('j');
  expect(compare.querySelector('.missing')!.textContent).toBe('i');
  expect(card().querySelector('.atlas-typein-answer')!.textContent).toBe('Paris');
  expect(screen.queryByPlaceholderText('Type your answer, then press Enter')).toBeNull();
});

test('intervals hidden when the setting is off; remaining count hidden too', async () => {
  await updateSettings(db, { showIntervalsOnButtons: false, showRemainingCount: false });
  await seedNote(seedDeps, deck, 'basic', ['a', 'x']);
  const { user } = await study();
  await screen.findByTestId('study-card');
  expect(screen.queryByText('1 left')).toBeNull();
  await user.keyboard(' ');
  expect((await screen.findByRole('button', { name: /^Good/ })).textContent).toBe('3Good');
});

test('studying a deck with nothing due shows the empty state with Add card', async () => {
  const { user } = await study();
  expect(await screen.findByRole('heading', { name: 'Nothing to study in Chemistry right now' })).toBeTruthy();
  expect(screen.getByText('New cards you add will show up here.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Add card' }));
  expect(await screen.findByRole('dialog', { name: 'Add card' })).toBeTruthy();
  expect(screen.getByTestId('today-screen')).toBeTruthy();
});

test('session complete shows stats and Enter goes back to Today', async () => {
  await seedNote(seedDeps, deck, 'basic', ['a', 'x']);
  const { user, clock } = await study();
  await screen.findByTestId('study-card');
  await user.keyboard(' ');
  await screen.findByRole('button', { name: /^Easy/ });
  clock.advance(5000);
  await user.keyboard('4');
  expect(await screen.findByRole('heading', { name: 'Session complete' })).toBeTruthy();
  expect(screen.getByText('1 card · 1 minute · 100% remembered')).toBeTruthy();
  await user.keyboard('{Enter}');
  expect(await screen.findByTestId('today-screen')).toBeTruthy();
});

test('learning cards come back while you wait', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: T0 });
  await updateSettings(db, { learnAheadMinutes: 0 });
  await seedNote(seedDeps, deck, 'basic', ['returning', 'x']);
  const clock = fixedClock(T0);
  const { user } = await study({ clock, fakeTimers: true });
  await screen.findByTestId('study-card');
  await user.keyboard(' ');
  await screen.findByRole('button', { name: /^Good/ });
  await user.keyboard('3');
  expect(await screen.findByText('1 card comes back in 10 minutes. Atlas will bring them up if you stay here.')).toBeTruthy();
  clock.advance(10 * MIN);
  await act(async () => vi.advanceTimersByTime(10 * MIN));
  expect(await screen.findByTestId('study-card')).toBeTruthy();
  await waitFor(() => expect(card().textContent).toContain('returning'));
});

test('a session started before the rollover still grades after it', async () => {
  const late = fixedClock(Date.UTC(2026, 10, 1, 3, 50));
  await seedNote({ ...seedDeps, clock: late }, deck, 'basic', ['a', 'x']);
  const { user } = await study({ clock: late });
  await screen.findByTestId('study-card');
  late.advance(20 * MIN);
  await user.keyboard(' ');
  await screen.findByRole('button', { name: /^Good/ });
  await user.keyboard('3');
  await waitFor(async () => expect(await countRows(db, 'revlog')).toBe(1));
  expect(screen.getByRole('status').textContent).not.toContain("couldn't");
});

test('a failed answer keeps the card and says why', async () => {
  await seedNote(seedDeps, deck, 'basic', ['a', 'x']);
  const { user, deps } = await study();
  await screen.findByTestId('study-card');
  await user.keyboard(' ');
  await screen.findByRole('button', { name: /^Good/ });
  const batch = deps.db.batch.bind(deps.db);
  deps.db.batch = vi.fn().mockRejectedValueOnce(new Error('disk I/O error')).mockImplementation(batch);
  await user.keyboard('3');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain("Atlas couldn't save that answer: disk I/O error"));
  expect(screen.getByRole('button', { name: /^Good/ })).toBeTruthy();
  expect(await countRows(db, 'revlog')).toBe(0);
});

test('Esc leaves Study', async () => {
  await seedNote(seedDeps, deck, 'basic', ['a', 'x']);
  const { user } = await study();
  await screen.findByTestId('study-card');
  await user.keyboard('{Escape}');
  expect(await screen.findByTestId('today-screen')).toBeTruthy();
});

describe('a learning card falling due does not change the card being studied', () => {
  async function twoCards() {
    await updateSettings(db, { learnAheadMinutes: 0 });
    const first = (await seedNote(seedDeps, deck, 'basic', ['first', 'x'])).cardIds[0]!;
    const second = (await seedNote(seedDeps, deck, 'basic', ['second', 'x'])).cardIds[0]!;
    const r = await study();
    await waitFor(() => expect(card().textContent).toContain('first'));
    await r.user.keyboard(' ');
    await screen.findByRole('button', { name: /^Again/ });
    await r.user.keyboard('1');
    await waitFor(() => expect(card().textContent).toContain('second'));
    return { ...r, first, second };
  }

  test('in the answer phase, 3 grades the card on screen', async () => {
    const { user, clock, second } = await twoCards();
    await user.keyboard(' ');
    await screen.findByRole('button', { name: /^Good/ });
    clock.advance(2 * MIN);
    await user.keyboard('3');
    await waitFor(async () => expect(await countRows(db, 'revlog')).toBe(2));
    const [last] = await db.query<{ card_id: number }>('SELECT card_id FROM revlog ORDER BY id DESC LIMIT 1');
    expect(last!.card_id).toBe(second);
    await waitFor(() => expect(card().textContent).toContain('first'));
  });

  test('in the question phase, Space reveals the card on screen', async () => {
    const { user, clock } = await twoCards();
    clock.advance(2 * MIN);
    await user.keyboard(' ');
    await screen.findByRole('button', { name: /^Good/ });
    expect(card().textContent).toContain('second');
  });

  test('bury hides the card on screen', async () => {
    const { user, clock, first, second } = await twoCards();
    clock.advance(2 * MIN);
    await user.keyboard('-');
    await waitFor(async () => expect((await getCard(db, second)).buriedKind).toBe('manual'));
    expect((await getCard(db, first)).buriedKind).toBeNull();
  });
});

test('Esc leaves Study even from the type-in box', async () => {
  await seedNote(seedDeps, deck, 'basic_typein', ['Capital of France?', 'Paris']);
  const { user } = await study();
  await user.type(await screen.findByPlaceholderText('Type your answer, then press Enter'), 'Par{Escape}');
  expect(await screen.findByTestId('today-screen')).toBeTruthy();
});

test('re-entering a deck whose only card returns later shows the empty state with when it returns', async () => {
  await updateSettings(db, { learnAheadMinutes: 0 });
  const id = (await seedNote(seedDeps, deck, 'basic', ['later', 'x'])).cardIds[0]!;
  await db.execute(`UPDATE cards SET state = 1, due_at = ?, new_position = NULL, scheduled_days = 0, reps = 1, last_review_at = ? WHERE id = ?`, [T0 + 10 * MIN, T0, id]);
  await study();
  expect(await screen.findByRole('heading', { name: 'Nothing to study in Chemistry right now' })).toBeTruthy();
  expect(screen.getByText('1 card comes back in 10 minutes. Atlas will bring them up if you stay here.')).toBeTruthy();
  expect(screen.queryByText(/remembered/)).toBeNull();
});
