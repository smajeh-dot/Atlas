export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
export type StateValue = 0 | 1 | 2 | 3;
/** 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type Rating = 1 | 2 | 3 | 4;
/** 0 learn, 1 review, 2 relearn, 3 filtered, 4 manual. */
export type RevlogKind = 0 | 1 | 2 | 3 | 4;

export interface PresetConfig {
  newPerDay: number;
  reviewsPerDay: number;
  learningSteps: string[];
  relearningSteps: string[];
  desiredRetention: number;
  maximumIntervalDays: number;
  fsrsWeights: number[] | null;
  enableFuzz: boolean;
  leechThreshold: number;
  leechAction: 'suspend' | 'tag';
  buryNewSiblings: boolean;
  buryReviewSiblings: boolean;
  buryInterdaySiblings: boolean;
  newCardOrder: 'added' | 'random';
  newReviewMix: 'mixed' | 'newFirst' | 'reviewsFirst';
  maxAnswerSeconds: number;
}

export const DEFAULT_PRESET: PresetConfig = {
  newPerDay: 20,
  reviewsPerDay: 200,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  desiredRetention: 0.9,
  maximumIntervalDays: 36500,
  fsrsWeights: null,
  enableFuzz: true,
  leechThreshold: 8,
  leechAction: 'suspend',
  buryNewSiblings: true,
  buryReviewSiblings: true,
  buryInterdaySiblings: false,
  newCardOrder: 'added',
  newReviewMix: 'mixed',
  maxAnswerSeconds: 60,
};

export interface Settings {
  theme: 'workbench' | 'tangerine';
  dayStartHour: number;
  learnAheadMinutes: number;
  showIntervalsOnButtons: boolean;
  showRemainingCount: boolean;
  showTimer: boolean;
  autoBackup: boolean;
  lastDeckId: number | null;
  lastNoteTypeId: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'workbench',
  dayStartHour: 4,
  learnAheadMinutes: 20,
  showIntervalsOnButtons: true,
  showRemainingCount: true,
  showTimer: false,
  autoBackup: true,
  lastDeckId: null,
  lastNoteTypeId: null,
};

export interface Preset {
  id: number;
  name: string;
  config: PresetConfig;
}

export interface Deck {
  id: number;
  name: string;
  parentId: number | null;
  presetId: number;
  colour: number | null;
  position: number;
  collapsed: boolean;
  kind: 'normal' | 'filtered';
  createdAt: number;
}

export type BuiltinNoteType = 'basic' | 'basic_reversed' | 'basic_typein' | 'cloze' | 'image_occlusion';

export interface NoteTemplate {
  name: string;
  front: string;
  back: string;
}

export interface NoteType {
  id: number;
  name: string;
  kind: 'standard' | 'cloze';
  builtin: BuiltinNoteType | null;
  fields: { name: string }[];
  templates: NoteTemplate[];
  css: string;
}

export interface Note {
  id: number;
  guid: string;
  noteTypeId: number;
  fields: string[];
  sortField: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Card {
  id: number;
  noteId: number;
  ord: number;
  deckId: number;
  originalDeckId: number | null;
  state: StateValue;
  dueAt: number | null;
  newPosition: number | null;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReviewAt: number | null;
  suspended: boolean;
  buriedDay: number | null;
  buriedKind: 'sibling' | 'manual' | null;
  flag: number;
  createdAt: number;
  updatedAt: number;
}

export interface RevlogEntry {
  id: number;
  cardId: number;
  rating: 0 | Rating;
  stateBefore: StateValue;
  dueBefore: number | null;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  durationMs: number;
  kind: RevlogKind;
}
