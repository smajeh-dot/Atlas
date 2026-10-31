import { expect, test } from 'vitest';
import { formatInterval } from '../../src/core/format';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test.each([
  [30_000, '1 min'],
  [10 * MIN, '10 min'],
  [2 * HOUR, '2 hr'],
  [1 * DAY, '1 day'],
  [6 * DAY, '6 days'],
  [30 * DAY, '30 days'],
  [31 * DAY, '1 month'],
  [102 * DAY, '3.4 months'],
  [365 * DAY, '1 year'],
  [438 * DAY, '1.2 years'],
])('formatInterval(%i) is %s', (ms, text) => {
  expect(formatInterval(ms)).toBe(text);
});
