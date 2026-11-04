// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { MOCK_CARDS } from '../../src/ui/placeholderCards';
import { Session } from '../../src/ui/screens/Session/Session';

const navigate = vi.fn();
vi.mock('../../src/ui/app/AtlasContext', () => ({ useAtlas: () => ({ navigate }) }));

const left = () => screen.getByTestId('session-left').textContent;
const ALL = `${MOCK_CARDS.length} left`;
const ONE_LESS = `${MOCK_CARDS.length - 1} left`;
const bar = () => Number(screen.getByTestId('session-progress').getAttribute('aria-valuenow'));

test('flip, grade, undo, bury and leave on the mock session', async () => {
  const user = userEvent.setup();
  render(<Session />);
  expect(left()).toBe(ALL);

  // A grade does nothing while the question is showing.
  await user.keyboard('1');
  expect(bar()).toBe(0);

  await user.keyboard(' ');
  await user.keyboard('3');
  expect(bar()).toBe(1);
  expect(left()).toBe(ONE_LESS);

  // Undo returns to the same card with the answer showing.
  await user.keyboard('z');
  expect(bar()).toBe(0);
  expect(left()).toBe(ALL);

  // Bury removes the card from the queue; undo puts it back.
  await user.keyboard('b');
  expect(left()).toBe(ONE_LESS);
  await user.keyboard('z');
  expect(left()).toBe(ALL);

  // Flag toggles.
  await user.keyboard('f');
  expect(screen.getByRole('button', { name: 'Remove flag' })).toBeTruthy();

  // Edit opens a dialog, and saving changes the card text.
  await user.keyboard('e');
  const dialog = await screen.findByRole('dialog');
  const front = within(dialog).getByLabelText('Front');
  await user.clear(front);
  await user.type(front, 'Edited question');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(screen.getByText('Edited question')).toBeTruthy();

  // Leaving after grading asks first; Esc cancels the dialog, Leave goes to Today.
  await user.keyboard(' ');
  await user.keyboard('2');
  await user.click(screen.getByRole('button', { name: /Leave session/ }));
  expect(await screen.findByRole('dialog', { name: 'Leave this session?' })).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Leave' }));
  expect(navigate).toHaveBeenCalledWith({ name: 'today' });
});

test('Esc leaves straight away before anything is marked', async () => {
  navigate.mockClear();
  const user = userEvent.setup();
  render(<Session />);
  await user.keyboard('{Escape}');
  expect(navigate).toHaveBeenCalledWith({ name: 'today' });
});
