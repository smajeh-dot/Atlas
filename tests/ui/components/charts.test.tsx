// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { BarChart } from '../../../src/ui/components/BarChart';
import { Heatmap, monthMarks } from '../../../src/ui/components/Heatmap';
import { studyDayDate } from '../../../src/core/studyDay';
import { heatmapGrid } from '../../../src/core/todayStats';
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

test('month names go over the first column of each new month and skip a cramped first one', () => {
  const day = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(2000, 0, 1)) / 86_400_000;
  const toCells = (g: (number | null)[][]): HeatCell[][] => g.map((col) => col.map((d) => (d === null ? null : { day: d, count: 0, level: 0, label: '' })));
  // Wednesday 4 Nov 2026 and the 52 weeks before it.
  const year = monthMarks(toCells(heatmapGrid(day(2026, 11, 4), 2, 53)));
  expect(year.map((m) => m.name)).toEqual(['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
  expect(year[0]!.col).toBe(0);
  // Three weeks starting Monday 20 Oct: Nov starts only two columns after Oct, so "Oct" would run into it and is dropped.
  const cramped = monthMarks(toCells(heatmapGrid(day(2025, 11, 5), 2, 3)));
  expect(cramped.map((m) => m.name)).toEqual(['Nov']);
  expect(studyDayDate(day(2026, 11, 4)).getUTCDay()).toBe(3);
});

test('BarChart highlights today and shows values and labels', () => {
  render(<BarChart label="Due in the next 7 days" bars={[{ label: 'Sat', count: 4, highlight: true }, { label: 'Sun', count: 0 }]} />);
  const items = within(screen.getByRole('list', { name: 'Due in the next 7 days' })).getAllByRole('listitem');
  expect(items.map((i) => i.textContent)).toEqual(['4Sat', '0Sun']);
  expect(items[0]!.getAttribute('data-highlight')).toBe('true');
});
