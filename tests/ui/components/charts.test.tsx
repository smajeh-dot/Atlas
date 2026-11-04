// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { BarChart } from '../../../src/ui/components/BarChart';
import { Heatmap } from '../../../src/ui/components/Heatmap';
import type { HeatCell } from '../../../src/services/todayService';

test('Heatmap draws 12 × 7 cells with levels and a tooltip label', async () => {
  const grid: HeatCell[][] = Array.from({ length: 12 }, (_, c) =>
    Array.from({ length: 7 }, (_, r) => (c === 11 && r === 6 ? null : { day: c * 7 + r, count: r, level: (r % 5) as 0 | 1 | 2 | 3 | 4, label: `day ${c}-${r}` })));
  render(<Heatmap grid={grid} />);
  const cells = screen.getByRole('img', { name: /Reviews per day/ }).querySelectorAll('[data-level]');
  expect(cells).toHaveLength(83);
  expect(cells[3]!.getAttribute('data-level')).toBe('3');
  await userEvent.setup().hover(cells[3]!);
  expect((await screen.findByRole('tooltip')).textContent).toBe('day 0-3');
});

test('BarChart highlights today and shows values and labels', () => {
  render(<BarChart label="Due in the next 7 days" bars={[{ label: 'Sat', count: 4, highlight: true }, { label: 'Sun', count: 0 }]} />);
  const items = within(screen.getByRole('list', { name: 'Due in the next 7 days' })).getAllByRole('listitem');
  expect(items.map((i) => i.textContent)).toEqual(['4Sat', '0Sun']);
  expect(items[0]!.getAttribute('data-highlight')).toBe('true');
});
