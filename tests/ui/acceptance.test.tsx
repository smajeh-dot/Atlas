// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { formatInterval } from '../../src/core/format';
import { StudySession } from '../../src/services/studySession';
import { UndoStack } from '../../src/services/undo';
import { T0 } from '../helpers/fixtures';
import { countRows } from '../helpers/seed';
import { renderApp } from '../helpers/renderApp';

vi.mock('../../src/ui/editor/FieldEditor', () => import('../helpers/fieldEditorStub'));

// Spec 7, Phase 2 "done when": a new user creates a deck, adds Basic, reversed, type-in and cloze cards
// with formatting, images and equations, and studies them with correct FSRS intervals, all by keyboard.
test('a new user creates a deck, adds four kinds of card and studies them by keyboard', async () => {
  const { user, db, deps } = await renderApp();
  await user.click(await screen.findByRole('button', { name: 'Start from scratch' }));
  await user.keyboard('{Enter}');
  await screen.findByRole('heading', { name: 'Add card' });

  const pickType = async (name: string) => {
    await user.click(screen.getByRole('button', { name: /^Type/ }));
    await user.click(screen.getByRole('option', { name }));
  };
  const add = async (fields: Record<string, string>) => {
    for (const [label, text] of Object.entries(fields)) await user.type(await screen.findByLabelText(label), text);
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(screen.getByLabelText(Object.keys(fields)[0]!)).toHaveProperty('value', ''));
  };

  await add({ Front: '<b>Mitochondria</b> make ATP \\(x^2\\) <img src="paste-aaaaaaaaaaaa.png">', Back: 'Powerhouse of the cell' });
  await pickType('Basic and reversed');
  await add({ Front: 'dog', Back: 'chien' });
  await pickType('Type the answer');
  await add({ Front: 'Capital of France?', Back: 'Paris' });
  await pickType('Cloze');
  await add({ Text: 'The {{{{c1::nucleus}} holds {{{{c2::DNA}}' });
  expect(await countRows(db, 'notes')).toBe(4);
  expect(await countRows(db, 'cards')).toBe(6);
  expect(screen.getByText('6 cards added this session')).toBeTruthy();

  await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Today' }));
  await screen.findByRole('heading', { name: 'Reviews done · 4 new cards ready' });
  await user.keyboard(' ');
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
});
