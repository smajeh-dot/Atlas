import { DEFAULT_PRESET, type Card, type Deck, type Note, type NoteType, type Preset, type RevlogEntry, type StateValue } from '../core/model';

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Tags are stored as " a b " so `LIKE '% a %'` finds whole tags. */
export function encodeTags(tags: string[]): string {
  return tags.length ? ` ${tags.join(' ')} ` : ' ';
}

export function decodeTags(s: unknown): string[] {
  return String(s ?? '').split(' ').filter(Boolean);
}

export function toDeck(r: Row): Deck {
  return {
    id: num(r.id),
    name: String(r.name),
    parentId: numOrNull(r.parent_id),
    presetId: num(r.preset_id),
    colour: numOrNull(r.colour),
    position: num(r.position),
    collapsed: num(r.collapsed) === 1,
    kind: r.kind === 'filtered' ? 'filtered' : 'normal',
    createdAt: num(r.created_at),
  };
}

export function toPreset(r: Row): Preset {
  // Merging over the defaults lets older presets pick up options added later.
  return { id: num(r.id), name: String(r.name), config: { ...DEFAULT_PRESET, ...JSON.parse(String(r.config)) } };
}

export function toNoteType(r: Row): NoteType {
  return {
    id: num(r.id),
    name: String(r.name),
    kind: r.kind === 'cloze' ? 'cloze' : 'standard',
    builtin: (r.builtin ?? null) as NoteType['builtin'],
    fields: JSON.parse(String(r.fields)),
    templates: JSON.parse(String(r.templates)),
    css: String(r.css ?? ''),
  };
}

export function toNote(r: Row): Note {
  return {
    id: num(r.id),
    guid: String(r.guid),
    noteTypeId: num(r.note_type_id),
    fields: JSON.parse(String(r.fields)),
    sortField: String(r.sort_field),
    tags: decodeTags(r.tags),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function toCard(r: Row): Card {
  return {
    id: num(r.id),
    noteId: num(r.note_id),
    ord: num(r.ord),
    deckId: num(r.deck_id),
    originalDeckId: numOrNull(r.original_deck_id),
    state: num(r.state) as StateValue,
    dueAt: numOrNull(r.due_at),
    newPosition: numOrNull(r.new_position),
    stability: num(r.stability),
    difficulty: num(r.difficulty),
    scheduledDays: num(r.scheduled_days),
    learningSteps: num(r.learning_steps),
    reps: num(r.reps),
    lapses: num(r.lapses),
    lastReviewAt: numOrNull(r.last_review_at),
    suspended: num(r.suspended) === 1,
    buriedDay: numOrNull(r.buried_day),
    buriedKind: (r.buried_kind ?? null) as Card['buriedKind'],
    flag: num(r.flag),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function toRevlog(r: Row): RevlogEntry {
  return {
    id: num(r.id),
    cardId: num(r.card_id),
    rating: num(r.rating) as RevlogEntry['rating'],
    stateBefore: num(r.state_before) as StateValue,
    dueBefore: numOrNull(r.due_before),
    stability: num(r.stability),
    difficulty: num(r.difficulty),
    elapsedDays: num(r.elapsed_days),
    scheduledDays: num(r.scheduled_days),
    durationMs: num(r.duration_ms),
    kind: num(r.kind) as RevlogEntry['kind'],
  };
}
