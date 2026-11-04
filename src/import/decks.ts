/**
 * Maps Anki decks and deck options onto Atlas decks and presets. Pure: no
 * database, no clock; ids come from the caller.
 *
 * - "A::B::C" becomes a chain of decks; each level reuses an existing deck
 *   with the same name (ignoring case) under the same parent.
 * - Filtered decks aren't created: their cards go back to their home decks.
 * - Anki's empty "Default" deck is skipped.
 * - Each Anki options group used by a new deck becomes a preset, unless it
 *   matches one that already exists. Existing decks keep their own preset.
 */
import { DEFAULT_PRESET, type Deck, type Preset, type PresetConfig } from '../core/model';
import type { ReportBuilder } from './report';
import type { SDeck, SDeckConfig } from './staging';

export interface IdSource {
  next(): number;
}

export function idsFrom(first: number): IdSource {
  let n = first;
  return { next: () => n++ };
}

export interface NewDeck {
  id: number;
  name: string;
  parentId: number | null;
  presetId: number;
  colour: number | null;
  position: number;
  createdAt: number;
}

export interface DeckPlan {
  /** Anki deck id → Atlas deck id, for every deck a card may call home. */
  deckFor: Map<number, number>;
  /** Atlas deck id → full "::" path, for rendering {{Deck}}. */
  pathOf: Map<number, string>;
  create: NewDeck[];
  presets: Preset[];
  /** Anki options group used by each Atlas deck id the import creates, for learning-step counts. */
  configOf: Map<number, SDeckConfig>;
}

export interface DeckPlanInput {
  decks: SDeck[];
  configs: SDeckConfig[];
  /** Cards per home deck, from staging. */
  homeDeckCounts: Map<number, number>;
  existingDecks: Deck[];
  existingPresets: Preset[];
  /** False for "no scheduling" exports, whose options are Anki's defaults, not the student's. */
  useDeckConfigs: boolean;
  deckIds: IdSource;
  presetIds: IdSource;
  now: number;
}

const DECK_COLOURS = 8;
const ANKI_DEFAULT_DECK = 1;
/** Where cards go if their deck is missing from the file. */
const FALLBACK_DECK = 'Imported';

/** Anki stores steps in minutes; Atlas presets use strings like "10m" or "1d". */
export function stepString(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  return m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : `${m}m`;
}

export function presetConfigFrom(c: SDeckConfig): PresetConfig {
  const retention = c.desiredRetention ?? DEFAULT_PRESET.desiredRetention;
  return {
    ...DEFAULT_PRESET,
    newPerDay: Math.max(0, Math.round(c.newPerDay)),
    reviewsPerDay: Math.max(0, Math.round(c.reviewsPerDay)),
    learningSteps: c.learnStepsMin.map(stepString),
    relearningSteps: c.relearnStepsMin.map(stepString),
    // FSRS only behaves sensibly in this range; Anki's own options enforce it too.
    desiredRetention: Math.min(0.99, Math.max(0.7, retention)),
  };
}

const sameConfig = (a: PresetConfig, b: PresetConfig) => JSON.stringify(a) === JSON.stringify(b);

function uniqueName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base} (imported)` : `${base} (imported ${i})`;
    if (!lower.has(name.toLowerCase())) return name;
  }
}

export function planDecks(input: DeckPlanInput, report: ReportBuilder): DeckPlan {
  const all: (Deck | NewDeck)[] = [...input.existingDecks];
  const presets: Preset[] = [...input.existingPresets];
  const plan: DeckPlan = { deckFor: new Map(), pathOf: new Map(), create: [], presets: [], configOf: new Map() };
  const configs = new Map(input.configs.map((c) => [c.id, c]));
  const presetForConfig = new Map<number, number>();

  const pathOf = (id: number): string => {
    const names: string[] = [];
    for (let d = all.find((x) => x.id === id); d; d = all.find((x) => x.id === d!.parentId)) names.unshift(d.name);
    return names.join('::');
  };

  const presetFor = (configId: number | null): number => {
    const c = configId === null || !input.useDeckConfigs ? undefined : configs.get(configId);
    if (!c) return 1;
    const known = presetForConfig.get(c.id);
    if (known !== undefined) return known;
    const config = presetConfigFrom(c);
    // Reuse any preset that already says exactly the same thing, including one an earlier import made.
    const same = presets.find((p) => sameConfig(p.config, config));
    let id: number;
    if (same) id = same.id;
    else {
      const preset = { id: input.presetIds.next(), name: uniqueName(c.name.trim() || 'Imported', presets.map((p) => p.name)), config };
      presets.push(preset);
      plan.presets.push(preset);
      id = preset.id;
    }
    presetForConfig.set(c.id, id);
    return id;
  };

  const nextColour = (): number => {
    const top = all.filter((d) => d.parentId === null);
    const used = new Set(top.map((d) => d.colour));
    for (let c = 1; c <= DECK_COLOURS; c++) if (!used.has(c)) return c;
    return (top.length % DECK_COLOURS) + 1;
  };

  /** Finds or creates `name` under `parentId`. */
  const child = (name: string, parentId: number | null, configId: number | null): number => {
    const found = all.find((d) => d.parentId === parentId && d.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const siblings = all.filter((d) => d.parentId === parentId);
    const deck: NewDeck = {
      id: input.deckIds.next(),
      name,
      parentId,
      presetId: presetFor(configId),
      colour: parentId === null ? nextColour() : null,
      position: siblings.reduce((m, d) => Math.max(m, d.position), -1) + 1,
      createdAt: input.now,
    };
    all.push(deck);
    plan.create.push(deck);
    const c = configId === null ? undefined : configs.get(configId);
    if (c && input.useDeckConfigs) plan.configOf.set(deck.id, c);
    return deck.id;
  };

  const byPath = new Map(input.decks.map((d) => [d.namePath.toLowerCase(), d]));
  const levels = (path: string) => path.split('::');
  // Parents before children, so each level's own options are used when it's created.
  const ordered = [...input.decks].sort(
    (a, b) => levels(a.namePath).length - levels(b.namePath).length || a.namePath.localeCompare(b.namePath),
  );
  const hasChildren = (d: SDeck) => input.decks.some((o) => o.namePath.toLowerCase().startsWith(`${d.namePath.toLowerCase()}::`));

  let filteredSkipped = 0;
  for (const d of ordered) {
    if (d.isFiltered) {
      filteredSkipped++;
      continue;
    }
    if (d.id === ANKI_DEFAULT_DECK && !input.homeDeckCounts.get(d.id) && !hasChildren(d)) continue;
    let parent: number | null = null;
    const parts = levels(d.namePath);
    let renamed = false;
    parts.forEach((raw, i) => {
      const clean = raw.trim();
      if (!clean) renamed = true;
      const name = clean || 'Untitled deck';
      const prefix = parts.slice(0, i + 1).join('::').toLowerCase();
      const own = byPath.get(prefix);
      parent = child(name, parent, own && !own.isFiltered ? own.configId : null);
    });
    if (renamed) report.warn('renamed-deck', d.namePath);
    plan.deckFor.set(d.id, parent!);
  }
  if (filteredSkipped) report.warn('filtered-deck', undefined, filteredSkipped);

  // Cards whose deck is missing from the file still need a home.
  for (const id of input.homeDeckCounts.keys()) {
    if (!plan.deckFor.has(id)) plan.deckFor.set(id, child(FALLBACK_DECK, null, null));
  }
  for (const id of new Set(plan.deckFor.values())) plan.pathOf.set(id, pathOf(id));
  return plan;
}
