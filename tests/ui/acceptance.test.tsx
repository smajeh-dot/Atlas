// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { formatInterval } from '../../src/core/format';
import { StudySession } from '../../src/services/studySession';
import { UndoStack } from '../../src/services/undo';
import { T0 } from '../helpers/fixtures';
import { listDecks } from '../../src/data/decks';
import { countRows, seedNote } from '../helpers/seed';
import { renderApp } from '../helpers/renderApp';

// Spec 7, Phase 2 "done when": a new user creates a deck, gets Basic, reversed, type-in and cloze cards with formatting, images
// and equations, and studies them with correct FSRS intervals, all by keyboard. The Add card screen is being rebuilt, so the
// cards go in through the note service instead of its form.
test('a new user creates a deck, has four kinds of card and studies them by keyboard', async () => {
  const first = await renderApp();
  const { db } = first;
  let { user, deps } = first;
  await user.click(await screen.findByRole('button', { name: 'Start from scratch' }));
  await user.keyboard('{Enter}');
  // Creating the first deck lands on Home with the (blank) Add card overlay open; Esc puts it away.
  await screen.findByRole('dialog', { name: 'Add card' });
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add card' })).toBeNull());

  const [deck] = await listDecks(db);
  const add = (type: 'basic' | 'basic_reversed' | 'basic_typein' | 'cloze', fields: string[]) => seedNote(deps, deck!.id, type, fields);
  await add('basic', ['<b>Mitochondria</b> make ATP \\(x^2\\) <img src="paste-aaaaaaaaaaaa.png">', 'Powerhouse of the cell']);
  await add('basic_reversed', ['dog', 'chien']);
  await add('basic_typein', ['Capital of France?', 'Paris']);
  await add('cloze', ['The {{c1::nucleus}} holds {{c2::DNA}}', '']);
  expect(await countRows(db, 'notes')).toBe(4);
  expect(await countRows(db, 'cards')).toBe(6);

  // The Today screen is being redesigned and has no way to start a session yet, so reopen the app in Study.
  first.unmount();
  ({ user, deps } = await renderApp({ db, route: { name: 'study', deckId: null } }));
  await screen.findByRole('button', { name: 'Leave study' });

  let answers = 0;
  for (let i = 0; i < 20 && !screen.queryByRole('heading', { name: 'Session complete' }); i++) {
    const probe = await StudySession.start({ ...deps, undo: new UndoStack() }, null);
    const expected = probe.current()!;
    const typeBox = screen.queryByPlaceholderText('Type your answer, then press Enter');
    if (typeBox) await user.type(typeBox, 'Paris{Enter}');
    else await user.keyboard(' ');
    const good = await screen.findByRole('button', { name: /^Good/ });
    expect(good.textContent).toBe(`3Good${formatInterval(expected.previews[3])}`);
    await user.keyboard('3');
    answers++;
    await waitFor(async () => expect(await countRows(db, 'revlog')).toBe(answers));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Good/ })).toBeNull());
  }

  expect(await screen.findByRole('heading', { name: 'Session complete' })).toBeTruthy();
  const studied = await db.query<{ due_at: number }>('SELECT due_at FROM cards WHERE id IN (SELECT card_id FROM revlog)');
  expect(studied).toHaveLength(4);
  expect(studied.every((c) => Number(c.due_at) > T0)).toBe(true);
}, 60_000);
