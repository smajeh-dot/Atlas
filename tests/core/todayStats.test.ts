import { expect, test } from 'vitest';
import { bannerText, estimateMinutes, heatLevels, heatmapGrid, streakDays } from '../../src/core/todayStats';

test('bannerText variants', () => {
  expect(bannerText({ due: 86, newCount: 20, minutes: 19, next: null })).toEqual({ title: '86 cards due today', sub: 'About 19 minutes · 20 new cards ready' });
  expect(bannerText({ due: 1, newCount: 0, minutes: 1, next: null }).title).toBe('1 card due today');
  expect(bannerText({ due: 0, newCount: 20, minutes: 4, next: null })).toEqual({ title: 'Reviews done · 20 new cards ready', sub: 'About 4 minutes' });
  expect(bannerText({ due: 0, newCount: 1, minutes: 1, next: null }).title).toBe('Reviews done · 1 new card ready');
  expect(bannerText({ due: 0, newCount: 0, minutes: 0, next: { inDays: 1, count: 34 } })).toEqual({ title: 'All done for today', sub: 'Next reviews: tomorrow, 34 cards' });
  expect(bannerText({ due: 0, newCount: 0, minutes: 0, next: { inDays: 5, count: 1 } }).sub).toBe('Next reviews: in 5 days, 1 card');
  expect(bannerText({ due: 0, newCount: 0, minutes: 0, next: null }).sub).toBe('No reviews scheduled yet');
  expect(bannerText({ due: 5, newCount: 0, minutes: 1, next: null }).sub).toBe('About 1 minute');
  expect(bannerText({ due: 5, newCount: 1, minutes: 2, next: null }).sub).toBe('About 2 minutes · 1 new card ready');
});

test('estimateMinutes defaults to 10 seconds a card and rounds up', () => {
  expect(estimateMinutes(86, null)).toBe(15);
  expect(estimateMinutes(5, 6000)).toBe(1);
  expect(estimateMinutes(0, null)).toBe(0);
});

test('streak ends today or yesterday', () => {
  expect(streakDays([10, 11, 12], 12)).toBe(3);
  expect(streakDays([12, 10, 11, 11], 12)).toBe(3);
  expect(streakDays([10, 11], 12)).toBe(2);
  expect(streakDays([10], 12)).toBe(0);
  expect(streakDays([], 12)).toBe(0);
  expect(streakDays([8, 9, 11, 12], 12)).toBe(2);
});

test('heatLevels by quartile of non-zero counts', () => {
  expect(heatLevels([0, 1, 2, 3, 4])).toEqual([0, 1, 2, 3, 4]);
  expect(heatLevels([0, 0])).toEqual([0, 0]);
  expect(heatLevels([10, 0, 50, 20, 100, 30, 40, 60])).toEqual([1, 0, 3, 1, 4, 2, 2, 4]);
});

test('heatmapGrid puts today in the last column at its weekday', () => {
  const g = heatmapGrid(1000, 5); // Saturday
  expect(g).toHaveLength(12);
  expect(g.every((col) => col.length === 7)).toBe(true);
  expect(g[11]![5]).toBe(1000);
  expect(g[11]![6]).toBeNull();
  expect(g[11]![0]).toBe(995);
  expect(g[0]![0]).toBe(1000 - 5 - 77);
});
