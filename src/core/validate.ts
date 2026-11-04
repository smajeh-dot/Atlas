import type { PresetConfig, Settings } from './model';

const isInt = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const STEP = /^\d+(\.\d+)?[mhd]$/;
const MAX_STEPS = 10;

/** Returns the first problem with a settings change as a user-facing message, or null when it can be saved. */
export function validateSettingsPatch(patch: Partial<Settings>): string | null {
  if ('theme' in patch && patch.theme !== 'workbench' && patch.theme !== 'tangerine') return 'Choose Light or Tangerine.';
  if ('dayStartHour' in patch && !isInt(patch.dayStartHour, 0, 23)) return 'The next day must start at a whole hour from 0 to 23.';
  if ('learnAheadMinutes' in patch && !isInt(patch.learnAheadMinutes, 0, 1440)) {
    return 'Show cards early by a whole number of minutes from 0 to 1440.';
  }
  for (const key of ['showIntervalsOnButtons', 'showRemainingCount', 'showTimer', 'autoBackup'] as const) {
    if (key in patch && typeof patch[key] !== 'boolean') return 'That setting has an invalid value.';
  }
  for (const key of ['lastDeckId', 'lastNoteTypeId'] as const) {
    if (key in patch && patch[key] !== null && !isInt(patch[key], 1, Number.MAX_SAFE_INTEGER)) return 'That setting has an invalid value.';
  }
  return null;
}

function validStep(s: string): boolean {
  return STEP.test(s) && parseFloat(s) > 0;
}

/** "1m 10m" → ["1m", "10m"]; null when any part is not a positive number followed by m, h or d. */
export function parseSteps(text: string): string[] | null {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return parts.every(validStep) && parts.length <= MAX_STEPS ? parts : null;
}

export function formatSteps(steps: string[]): string {
  return steps.join(' ');
}

/** Field-by-field problems with a deck options change; an empty object means it can be saved. */
export function validatePresetPatch(patch: Partial<PresetConfig>): Partial<Record<keyof PresetConfig, string>> {
  const out: Partial<Record<keyof PresetConfig, string>> = {};
  const has = (k: keyof PresetConfig) => k in patch;
  for (const k of ['newPerDay', 'reviewsPerDay'] as const) {
    if (has(k) && !isInt(patch[k], 0, 9999)) out[k] = 'Use a whole number from 0 to 9999.';
  }
  for (const k of ['learningSteps', 'relearningSteps'] as const) {
    const v = patch[k];
    if (has(k) && !(Array.isArray(v) && v.length <= MAX_STEPS && v.every((s) => typeof s === 'string' && validStep(s)))) {
      out[k] = 'Use numbers followed by m, h or d, like 1m 10m.';
    }
  }
  const r = patch.desiredRetention;
  if (has('desiredRetention') && !(typeof r === 'number' && r >= 0.7 - 1e-9 && r <= 0.99 + 1e-9)) {
    out.desiredRetention = 'Choose a value from 70% to 99%.';
  }
  if (has('maximumIntervalDays') && !isInt(patch.maximumIntervalDays, 1, 36500)) {
    out.maximumIntervalDays = 'Use a whole number of days from 1 to 36500.';
  }
  if (has('leechThreshold') && !isInt(patch.leechThreshold, 1, 99)) out.leechThreshold = 'Use a whole number from 1 to 99.';
  if (has('maxAnswerSeconds') && !isInt(patch.maxAnswerSeconds, 1, 3600)) out.maxAnswerSeconds = 'Use a whole number from 1 to 3600.';
  const choices: [keyof PresetConfig, unknown[]][] = [
    ['leechAction', ['suspend', 'tag']],
    ['newCardOrder', ['added', 'random']],
    ['newReviewMix', ['mixed', 'newFirst', 'reviewsFirst']],
    ['enableFuzz', [true, false]],
    ['buryNewSiblings', [true, false]],
    ['buryReviewSiblings', [true, false]],
    ['buryInterdaySiblings', [true, false]],
  ];
  for (const [k, allowed] of choices) if (has(k) && !allowed.includes(patch[k])) out[k] = 'That option has an invalid value.';
  const w = patch.fsrsWeights;
  if (has('fsrsWeights') && w !== null && !(Array.isArray(w) && w.every((x) => typeof x === 'number' && Number.isFinite(x)))) {
    out.fsrsWeights = 'That option has an invalid value.';
  }
  return out;
}
