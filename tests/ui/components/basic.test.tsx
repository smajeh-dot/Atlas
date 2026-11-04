// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { Button } from '../../../src/ui/components/Button';
import { Chip } from '../../../src/ui/components/Chip';
import { Count } from '../../../src/ui/components/Count';
import { EmptyState } from '../../../src/ui/components/EmptyState';
import { IconButton } from '../../../src/ui/components/IconButton';
import { Input } from '../../../src/ui/components/Input';
import { ProgressBar } from '../../../src/ui/components/ProgressBar';
import { Segmented } from '../../../src/ui/components/Segmented';
import { Slider } from '../../../src/ui/components/Slider';
import { Toggle } from '../../../src/ui/components/Toggle';
import { Tooltip } from '../../../src/ui/components/Tooltip';

test('Button shows its Kbd and does nothing when disabled', async () => {
  const onClick = vi.fn();
  render(<Button variant="primary" kbd="Ctrl+Enter" disabled onClick={onClick}>Add card</Button>);
  const b = screen.getByRole('button', { name: 'Add card' });
  expect(b).toHaveProperty('textContent', 'Add cardCtrl+Enter');
  expect(b.getAttribute('aria-keyshortcuts')).toBe('Control+Enter');
  await userEvent.click(b);
  expect(onClick).not.toHaveBeenCalled();
});

test('IconButton has an aria-label and a tooltip with its key on focus', async () => {
  const user = userEvent.setup();
  render(<IconButton icon="edit" label="Edit card" shortcut="E" onClick={() => {}} />);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Edit card' })).toBe(document.activeElement);
  expect(screen.getByRole('tooltip').textContent).toBe('Edit cardE');
});

test('Tooltip appears after 400 ms of hover', async () => {
  vi.useFakeTimers();
  render(<Tooltip text="Tue 27 Oct · 64 reviews"><span>cell</span></Tooltip>);
  act(() => screen.getByText('cell').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => vi.advanceTimersByTime(400));
  expect(screen.getByRole('tooltip').textContent).toBe('Tue 27 Oct · 64 reviews');
  vi.useRealTimers();
});

test('Toggle flips with click and Space', async () => {
  const user = userEvent.setup();
  function T() {
    const [on, setOn] = useState(false);
    return <Toggle checked={on} onChange={setOn} label="Show a timer" />;
  }
  render(<T />);
  const sw = screen.getByRole('switch', { name: 'Show a timer' });
  expect(sw.getAttribute('aria-checked')).toBe('false');
  await user.click(sw);
  expect(sw.getAttribute('aria-checked')).toBe('true');
  await user.keyboard(' ');
  expect(sw.getAttribute('aria-checked')).toBe('false');
});

test('Segmented moves with arrow keys', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Segmented label="Side" value="front" onChange={onChange} options={[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]} />);
  expect(screen.getByRole('radio', { name: 'Front' }).getAttribute('aria-checked')).toBe('true');
  screen.getByRole('radio', { name: 'Front' }).focus();
  await user.keyboard('{ArrowRight}');
  expect(onChange).toHaveBeenCalledWith('back');
});

test('Slider shows its formatted value', () => {
  render(<Slider label="Desired retention" min={0.7} max={0.99} step={0.01} value={0.9} onChange={() => {}} format={(v) => `${Math.round(v * 100)}%`} />);
  expect(screen.getByText('90%')).toBeTruthy();
  expect(screen.getByRole('slider', { name: 'Desired retention' })).toBeTruthy();
});

test('Input shows its label and error', () => {
  render(<Input label="Deck name" error="Give the deck a name." defaultValue="" />);
  expect(screen.getByLabelText('Deck name')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe('Give the deck a name.');
  expect(screen.getByLabelText('Deck name').getAttribute('aria-invalid')).toBe('true');
});

test('Count of zero is marked faint', () => {
  const { container } = render(<><Count kind="new" value={0} /><Count kind="due" value={12} /></>);
  const [zero, twelve] = container.querySelectorAll('[data-count]');
  expect(zero!.getAttribute('data-zero')).toBe('true');
  expect(twelve!.textContent).toBe('12');
  expect(twelve!.getAttribute('data-zero')).toBe('false');
});

test('ProgressBar, Chip and EmptyState', async () => {
  const onClick = vi.fn();
  render(<>
    <ProgressBar value={0.25} label="Progress" />
    <Chip>paper-1</Chip>
    <EmptyState title="Nothing here" text="Add a card." action={{ label: 'Add card', onClick }} />
  </>);
  expect(screen.getByRole('progressbar', { name: 'Progress' }).getAttribute('aria-valuenow')).toBe('25');
  expect(screen.getByText('paper-1')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Add card' }));
  expect(onClick).toHaveBeenCalled();
});
