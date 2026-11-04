/**
 * Reads the staging database written by the Rust package reader
 * (src-tauri/crates/anki-package/staging.sql). Values are Anki's own; this
 * module only gives them types. Notes, cards and reviews are read a chunk of
 * notes at a time so a huge deck never has to fit in memory at once.
 */
import type { Db } from '../data/db';

export const STAGING_VERSION = '1';

/** Read-only access to a staging database. */
export type StagingSource = Pick<Db, 'query'>;

export interface StagingMeta {
  sourceFormat: 'legacy1' | 'legacy2' | 'modern';
  sourceSha256: string;
  ankiSchema: number;
  ankiCrt: number;
  ankiRolloverHour: number;
  ankiCreationOffset: number | null;
}

export interface SDeck {
  id: number;
  namePath: string;
  isFiltered: boolean;
  configId: number | null;
}

export interface SDeckConfig {
  id: number;
  name: string;
  newPerDay: number;
  reviewsPerDay: number;
  learnStepsMin: number[];
  relearnStepsMin: number[];
  desiredRetention: number | null;
}

export interface SNoteType {
  id: number;
  name: string;
  kind: 'standard' | 'cloze';
  originalStockKind: number | null;
  css: string;
  fields: string[];
  templates: { name: string; qfmt: string; afmt: string }[];
}

export interface SNote {
  id: number;
  guid: string;
  notetypeId: number;
  modSecs: number;
  tags: string[];
  fields: string[];
}

export interface SCard {
  id: number;
  noteId: number;
  deckId: number;
  origDeckId: number;
  ord: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  odue: number;
  flags: number;
  fsrsS: number | null;
  fsrsD: number | null;
  dataLrt: number | null;
}

export interface SRevlog {
  id: number;
  cardId: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  timeMs: number;
  type: number;
}

export interface SMedia {
  name: string;
  originalName: string;
  size: number;
  sha1: string;
  stagedPath: string;
}

export interface Chunk {
  notes: SNote[];
  cards: SCard[];
  revlog: SRevlog[];
}

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v);
const nOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

function jsonArray(v: unknown): unknown[] {
  try {
    const parsed: unknown = JSON.parse(String(v));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export class StagingVersionError extends Error {}

export async function readMeta(src: StagingSource): Promise<StagingMeta> {
  const rows = await src.query<{ key: string; value: string }>(`SELECT key, value FROM meta`);
  const m = new Map(rows.map((r) => [r.key, r.value]));
  if (m.get('staging_version') !== STAGING_VERSION) {
    // A different Atlas build wrote this file; reading it with the wrong rules could corrupt an import.
    throw new StagingVersionError(`staging version ${m.get('staging_version')} is not ${STAGING_VERSION}`);
  }
  return {
    sourceFormat: (m.get('source_format') ?? 'modern') as StagingMeta['sourceFormat'],
    sourceSha256: m.get('source_sha256') ?? '',
    ankiSchema: n(m.get('anki_schema')),
    ankiCrt: n(m.get('anki_crt')),
    ankiRolloverHour: n(m.get('anki_rollover_hour') ?? 4),
    ankiCreationOffset: nOrNull(m.get('anki_creation_offset')),
  };
}

export async function readDecks(src: StagingSource): Promise<SDeck[]> {
  return (await src.query<Row>(`SELECT * FROM deck ORDER BY id`)).map((r) => ({
    id: n(r.id),
    namePath: String(r.name_path),
    isFiltered: n(r.is_filtered) === 1,
    configId: nOrNull(r.config_id),
  }));
}

export async function readDeckConfigs(src: StagingSource): Promise<SDeckConfig[]> {
  return (await src.query<Row>(`SELECT * FROM deck_config ORDER BY id`)).map((r) => ({
    id: n(r.id),
    name: String(r.name),
    newPerDay: n(r.new_per_day),
    reviewsPerDay: n(r.reviews_per_day),
    learnStepsMin: jsonArray(r.learn_steps_min_json).map(Number).filter(Number.isFinite),
    relearnStepsMin: jsonArray(r.relearn_steps_min_json).map(Number).filter(Number.isFinite),
    desiredRetention: nOrNull(r.desired_retention),
  }));
}

export async function readNoteTypes(src: StagingSource): Promise<SNoteType[]> {
  const fields = await src.query<Row>(`SELECT * FROM field ORDER BY notetype_id, ord`);
  const templates = await src.query<Row>(`SELECT * FROM template ORDER BY notetype_id, ord`);
  return (await src.query<Row>(`SELECT * FROM notetype ORDER BY id`)).map((r) => ({
    id: n(r.id),
    name: String(r.name),
    kind: r.kind === 'cloze' ? 'cloze' : 'standard',
    originalStockKind: nOrNull(r.original_stock_kind),
    css: String(r.css ?? ''),
    fields: fields.filter((f) => n(f.notetype_id) === n(r.id)).map((f) => String(f.name)),
    templates: templates
      .filter((t) => n(t.notetype_id) === n(r.id))
      .map((t) => ({ name: String(t.name), qfmt: String(t.qfmt), afmt: String(t.afmt) })),
  }));
}

export async function readMedia(src: StagingSource): Promise<SMedia[]> {
  return (await src.query<Row>(`SELECT * FROM media ORDER BY staged_path`)).map((r) => ({
    name: String(r.name),
    originalName: String(r.original_name),
    size: n(r.size),
    sha1: String(r.sha1),
    stagedPath: String(r.staged_path),
  }));
}

export async function countRows(src: StagingSource): Promise<{ notes: number; cards: number; revlog: number }> {
  const one = async (t: string) => n((await src.query<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`))[0]?.c ?? 0);
  return { notes: await one('note'), cards: await one('card'), revlog: await one('revlog') };
}

/** How many cards live in each home deck (a filtered deck's cards count for their original deck). */
export async function homeDeckCounts(src: StagingSource): Promise<Map<number, number>> {
  const rows = await src.query<{ d: number; c: number }>(
    `SELECT CASE WHEN orig_deck_id != 0 THEN orig_deck_id ELSE deck_id END AS d, COUNT(*) AS c FROM card GROUP BY d`,
  );
  return new Map(rows.map((r) => [n(r.d), n(r.c)]));
}

function toNote(r: Row): SNote {
  return {
    id: n(r.id),
    guid: String(r.guid),
    notetypeId: n(r.notetype_id),
    modSecs: n(r.mod_secs),
    tags: jsonArray(r.tags_json).map(String),
    fields: jsonArray(r.fields_json).map(String),
  };
}

function toCard(r: Row): SCard {
  return {
    id: n(r.id), noteId: n(r.note_id), deckId: n(r.deck_id), origDeckId: n(r.orig_deck_id), ord: n(r.ord),
    type: n(r.type), queue: n(r.queue), due: n(r.due), ivl: n(r.ivl), factor: n(r.factor), reps: n(r.reps),
    lapses: n(r.lapses), left: n(r.left), odue: n(r.odue), flags: n(r.flags), fsrsS: nOrNull(r.fsrs_s),
    fsrsD: nOrNull(r.fsrs_d), dataLrt: nOrNull(r.data_lrt),
  };
}

function toRevlog(r: Row): SRevlog {
  return {
    id: n(r.id), cardId: n(r.card_id), ease: n(r.ease), ivl: n(r.ivl), lastIvl: n(r.last_ivl), factor: n(r.factor),
    timeMs: n(r.time_ms), type: n(r.type),
  };
}

/** Notes in id order, `size` at a time, each with all its cards and their reviews. */
export async function* noteChunks(src: StagingSource, size: number): AsyncGenerator<Chunk> {
  let after = -Infinity;
  for (;;) {
    const notes = (await src.query<Row>(`SELECT * FROM note WHERE id > ? ORDER BY id LIMIT ?`, [
      Number.isFinite(after) ? after : Number.MIN_SAFE_INTEGER,
      size,
    ])).map(toNote);
    if (!notes.length) return;
    const first = notes[0]!.id;
    const last = notes[notes.length - 1]!.id;
    const cards = (await src.query<Row>(`SELECT * FROM card WHERE note_id BETWEEN ? AND ? ORDER BY note_id, ord, id`, [
      first,
      last,
    ])).map(toCard);
    const revlog = (await src.query<Row>(
      `SELECT r.* FROM revlog r JOIN card c ON c.id = r.card_id WHERE c.note_id BETWEEN ? AND ? ORDER BY r.id`,
      [first, last],
    )).map(toRevlog);
    yield { notes, cards, revlog };
    after = last;
  }
}
