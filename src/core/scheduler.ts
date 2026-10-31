import {
  fsrs,
  generatorParameters,
  GenSeedStrategyWithCardId,
  StrategyMode,
  type Card as FsrsCard,
  type FSRS,
  type Grade,
  type RecordLogItem,
  type StepUnit,
} from 'ts-fsrs';
import type { Card, PresetConfig, Rating, RevlogKind, StateValue } from './model';

const DAY_MS = 86_400_000;

export type ScheduleFields = Pick<
  Card,
  'state' | 'dueAt' | 'stability' | 'difficulty' | 'scheduledDays' | 'learningSteps' | 'reps' | 'lapses' | 'lastReviewAt'
>;

export interface Outcome {
  card: ScheduleFields;
  log: {
    rating: Rating;
    stateBefore: StateValue;
    dueBefore: number | null;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    kind: RevlogKind;
  };
}

const instances = new Map<string, FSRS>();

function schedulerFor(preset: PresetConfig): FSRS {
  const params = {
    request_retention: preset.desiredRetention,
    maximum_interval: preset.maximumIntervalDays,
    enable_fuzz: preset.enableFuzz,
    enable_short_term: true,
    learning_steps: preset.learningSteps as StepUnit[],
    relearning_steps: preset.relearningSteps as StepUnit[],
    ...(preset.fsrsWeights ? { w: preset.fsrsWeights } : {}),
  };
  const key = JSON.stringify(params);
  let f = instances.get(key);
  if (!f) {
    f = fsrs(generatorParameters(params));
    // Seeding fuzz from the card id (not the answer time) makes the interval
    // shown on a button equal what pressing it a few seconds later gives.
    f.useStrategy(StrategyMode.SEED, GenSeedStrategyWithCardId('cid'));
    instances.set(key, f);
  }
  return f;
}

function toFsrs(card: Card, now: number): FsrsCard & { cid: number } {
  return {
    due: new Date(card.dueAt ?? now),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.lastReviewAt === null ? 0 : (now - card.lastReviewAt) / DAY_MS,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    ...(card.lastReviewAt === null ? {} : { last_review: new Date(card.lastReviewAt) }),
    cid: card.id,
  };
}

const KIND_BY_STATE: Record<StateValue, RevlogKind> = { 0: 0, 1: 0, 2: 1, 3: 2 };

function toOutcome(before: Card, item: RecordLogItem, now: number, rating: Rating): Outcome {
  const c = item.card;
  return {
    card: {
      state: c.state as StateValue,
      dueAt: c.due.getTime(),
      stability: c.stability,
      difficulty: c.difficulty,
      scheduledDays: c.scheduled_days,
      learningSteps: c.learning_steps,
      reps: c.reps,
      lapses: c.lapses,
      lastReviewAt: c.last_review ? c.last_review.getTime() : now,
    },
    log: {
      rating,
      stateBefore: before.state,
      dueBefore: before.dueAt,
      stability: c.stability,
      difficulty: c.difficulty,
      elapsedDays: before.lastReviewAt === null ? 0 : (now - before.lastReviewAt) / DAY_MS,
      scheduledDays: c.scheduled_days,
      kind: KIND_BY_STATE[before.state],
    },
  };
}

export function previewAll(card: Card, now: number, preset: PresetConfig): Record<Rating, Outcome> {
  const preview = schedulerFor(preset).repeat(toFsrs(card, now), new Date(now));
  const out = {} as Record<Rating, Outcome>;
  for (const r of [1, 2, 3, 4] as Rating[]) out[r] = toOutcome(card, preview[r as Grade], now, r);
  return out;
}

export function answerCard(card: Card, now: number, rating: Rating, preset: PresetConfig): Outcome {
  const item = schedulerFor(preset).next(toFsrs(card, now), new Date(now), rating as Grade);
  return toOutcome(card, item, now, rating);
}

/** A (re)learning card that comes back later the same day. */
export function isIntraday(card: Pick<ScheduleFields, 'state' | 'scheduledDays'>): boolean {
  return (card.state === 1 || card.state === 3) && card.scheduledDays < 1;
}
