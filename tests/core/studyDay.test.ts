import { expect, test } from 'vitest';
import { nextRollover, startOfStudyDay, studyDay } from '../../src/core/studyDay';

// Local (Europe/London) wall-clock strings.
const at = (s: string) => new Date(s).getTime();

test('03:59 belongs to the previous study day', () => {
  expect(studyDay(at('2026-10-31T03:59'), 4)).toBe(studyDay(at('2026-10-30T12:00'), 4));
  expect(studyDay(at('2026-10-31T04:00'), 4)).toBe(studyDay(at('2026-10-30T12:00'), 4) + 1);
});

test('clocks going back (25 Oct 2026) still gives consecutive days', () => {
  expect(studyDay(at('2026-10-26T10:00'), 4) - studyDay(at('2026-10-25T10:00'), 4)).toBe(1);
  expect(nextRollover(at('2026-10-25T10:00'), 4)).toBe(at('2026-10-26T04:00'));
});

test('startOfStudyDay round-trips across clocks going forward', () => {
  const d = studyDay(at('2026-03-29T09:00'), 4);
  expect(startOfStudyDay(d, 4)).toBe(at('2026-03-29T04:00'));
});

test('dayStartHour 0 means midnight', () => {
  expect(studyDay(at('2026-10-31T00:30'), 0)).toBe(studyDay(at('2026-10-31T23:59'), 0));
  expect(studyDay(at('2026-11-01T00:00'), 0)).toBe(studyDay(at('2026-10-31T23:59'), 0) + 1);
});

test('day numbers count from 1 January 2000', () => {
  expect(studyDay(at('2000-01-01T12:00'), 4)).toBe(0);
  expect(studyDay(at('2000-01-02T12:00'), 4)).toBe(1);
});
