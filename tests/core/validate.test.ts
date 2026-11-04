import { expect, test } from 'vitest';
import { formatSteps, parseSteps, validatePresetPatch, validateSettingsPatch } from '../../src/core/validate';

test.each([[-1], [24], [4.5], [Number.NaN]])('dayStartHour %s is rejected', (h) => {
  expect(validateSettingsPatch({ dayStartHour: h })).toBe('The next day must start at a whole hour from 0 to 23.');
});

test('a valid settings patch passes', () => {
  expect(validateSettingsPatch({ dayStartHour: 0, theme: 'workbench' })).toBeNull();
  expect(validateSettingsPatch({ lastDeckId: null, showTimer: true })).toBeNull();
});

test('learnAheadMinutes must be 0-1440 whole minutes', () => {
  expect(validateSettingsPatch({ learnAheadMinutes: 1441 })).toBe('Show cards early by a whole number of minutes from 0 to 1440.');
  expect(validateSettingsPatch({ learnAheadMinutes: -1 })).toBe('Show cards early by a whole number of minutes from 0 to 1440.');
  expect(validateSettingsPatch({ learnAheadMinutes: 0 })).toBeNull();
});

test('unknown theme is rejected', () => {
  expect(validateSettingsPatch({ theme: 'graphite' as never })).toBe('Atlas only has the Light theme.');
  expect(validateSettingsPatch({ theme: 'tangerine' as never })).toBe('Atlas only has the Light theme.');
});

test('non-boolean toggles and bad ids are rejected', () => {
  expect(validateSettingsPatch({ showTimer: 'yes' as never })).toBe('That setting has an invalid value.');
  expect(validateSettingsPatch({ lastDeckId: 1.5 })).toBe('That setting has an invalid value.');
});

test('parseSteps', () => {
  expect(parseSteps(' 1m  10m ')).toEqual(['1m', '10m']);
  expect(parseSteps('1.5h 2d')).toEqual(['1.5h', '2d']);
  expect(parseSteps('')).toEqual([]);
  expect(parseSteps('10')).toBeNull();
  expect(parseSteps('0m')).toBeNull();
  expect(parseSteps('5x')).toBeNull();
});

test('formatSteps joins with spaces', () => {
  expect(formatSteps(['1m', '10m'])).toBe('1m 10m');
});

test('preset limits, steps, retention, interval and leech threshold', () => {
  expect(validatePresetPatch({ newPerDay: -1 }).newPerDay).toBe('Use a whole number from 0 to 9999.');
  expect(validatePresetPatch({ reviewsPerDay: 10000 }).reviewsPerDay).toBe('Use a whole number from 0 to 9999.');
  expect(validatePresetPatch({ desiredRetention: 0.6 }).desiredRetention).toBe('Choose a value from 70% to 99%.');
  expect(validatePresetPatch({ learningSteps: ['10'] }).learningSteps).toBe('Use numbers followed by m, h or d, like 1m 10m.');
  expect(validatePresetPatch({ relearningSteps: ['0m'] }).relearningSteps).toBe('Use numbers followed by m, h or d, like 1m 10m.');
  expect(validatePresetPatch({ maximumIntervalDays: 0 }).maximumIntervalDays).toBe('Use a whole number of days from 1 to 36500.');
  expect(validatePresetPatch({ leechThreshold: 0 }).leechThreshold).toBe('Use a whole number from 1 to 99.');
  expect(validatePresetPatch({ newCardOrder: 'sideways' as never }).newCardOrder).toBe('That option has an invalid value.');
  expect(validatePresetPatch({ newPerDay: 20, desiredRetention: 0.9, learningSteps: [] })).toEqual({});
});
