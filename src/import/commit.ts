/**
 * Writes an import into Atlas, safely.
 *
 * 1. Backs up atlas.db first; if that fails, nothing is written.
 * 2. Records an import batch and tags every row it adds with the batch id.
 * 3. Writes notes in chunks (one transaction each), checking for Cancel
 *    between chunks.
 * 4. Checks the database (quick_check, foreign keys) before calling it done.
 *
 * If anything fails or is cancelled, everything tagged with the batch is
 * removed, updated notes get their old text back, and its media files are
 * deleted: the database ends up as it was. If the app is killed mid-import,
 * the batch is still "running" on the next launch and
 * `recoverInterruptedImports` removes it the same way.
 *
 * The importer assumes it is the only writer while it runs (the UI is locked),
 * so ids can be reserved up front as MAX(id) + 1.
 */
import { DEFAULT_PRESET, type Card, type Note, type NoteType, type PresetConfig, type RevlogEntry } from '../core/model';
import { CARD_COLUMNS, cardValues } from '../data/cards';
import type { Db, Statement } from '../data/db';
import { listDecks } from '../data/decks';
import { listNoteTypes } from '../data/noteTypes';
import { listPresets } from '../data/presets';
import { decodeTags, encodeTags } from '../data/rows';
import { getSettings } from '../data/settings';
import { idsFrom, planDecks, type DeckPlan } from './decks';
import { planMedia, rewriteReferences, type MediaInstall } from './media';
import { planNoteTypes } from './noteTypes';
import { planChunk, RevlogIds, type ExistingNote, type PlanContext } from './plan';
import { ReportBuilder, type ImportReport, type ImportWarning } from './report';
import { ankiToday } from './schedule';
import {
  countRows, homeDeckCounts, noteChunks, readDeckConfigs, readDecks, readMedia, readMeta, readNoteTypes,
  type SDeckConfig, type StagingSource,
} from './staging';

/** What the importer needs from outside the database. */
export interface ImportPlatform {
  /** Copies staged files into the media folder under the names given. */
  installMedia(files: MediaInstall[]): Promise<void>;
  /** Deletes files from the media folder; missing files are fine. */
  removeMedia(names: string[]): Promise<void>;
  /** Copies atlas.db somewhere safe and returns where. */
  backup(): Promise<string>;
}

export type ImportStage = 'backup' | 'setup' | 'notes' | 'media' | 'checking';

export interface ImportProgress {
  stage: ImportStage;
  done: number;
  total: number;
}

export interface ImportOptions {
  /** The file name, shown in the report and kept with the batch. */
  sourceName: string;
  clock: { now(): number };
  /** Refresh the text and tags of notes Atlas already has. Scheduling is never replaced. */
  updateExisting?: boolean;
  /** Notes per transaction. */
  chunkSize?: number;
  signal?: AbortSignal;
  onProgress?(p: ImportProgress): void;
}

export class ImportCancelled extends Error {
  constructor() {
    super('The import was cancelled. Nothing was changed.');
  }
}

export class ImportBusyError extends Error {
  constructor() {
    super('An import is already running. Wait for it to finish.');
  }
}

export class BackupFailedError extends Error {
  constructor(cause: unknown) {
    super("Atlas couldn't make a backup before importing, so nothing was changed. Check there's free space and try again.");
    this.cause = cause;
  }
}

export class IntegrityError extends Error {
  constructor(detail: string) {
    super('Atlas found a problem after importing and undid the import. Your cards are as they were.');
    this.cause = detail;
  }
}

const DEFAULT_CHUNK = 500;
/** Kept under SQLite's oldest parameter limit (999) so multi-row inserts work everywhere. */
const MAX_PARAMS = 900;

let running = false;

/** Inserts many rows with as few statements as the parameter limit allows. */
function insertRows(table: string, columns: readonly string[], rows: unknown[][]): Statement[] {
  if (!rows.length) return [];
  const per = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  const one = `(${columns.map(() => '?').join(', ')})`;
  const out: Statement[] = [];
  for (let i = 0; i < rows.length; i += per) {
    const slice = rows.slice(i, i + per);
    out.push({
      sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${slice.map(() => one).join(', ')}`,
      params: slice.flat(),
    });
  }
  return out;
}

const NOTE_COLUMNS = ['id', 'guid', 'note_type_id', 'fields', 'sort_field', 'tags', 'created_at', 'updated_at', 'import_batch_id'];
const noteRow = (n: Note, batch: number) => [
  n.id, n.guid, n.noteTypeId, JSON.stringify(n.fields), n.sortField, encodeTags(n.tags), n.createdAt, n.updatedAt, batch,
];
const REVLOG_COLUMNS = [
  'id', 'card_id', 'rating', 'state_before', 'due_before', 'stability', 'difficulty', 'elapsed_days', 'scheduled_days',
  'duration_ms', 'kind',
];
const revlogRow = (e: RevlogEntry) => [
  e.id, e.cardId, e.rating, e.stateBefore, e.dueBefore, e.stability, e.difficulty, e.elapsedDays, e.scheduledDays,
  e.durationMs, e.kind,
];
const cardRow = (c: Card, batch: number) => [c.id, ...cardValues(c), batch];

async function maxOf(db: Db, sql: string): Promise<number> {
  const [row] = await db.query<{ m: number | null }>(sql);
  return Number(row?.m ?? 0);
}

/** Notes Atlas already has with these guids, with the card ords they have. */
async function existingByGuid(db: Db, guids: string[]): Promise<Map<string, ExistingNote>> {
  const out = new Map<string, ExistingNote>();
  if (!guids.length) return out;
  const rows = await db.query<{ id: number; guid: string; note_type_id: number; fields: string; tags: string }>(
    `SELECT id, guid, note_type_id, fields, tags FROM notes WHERE guid IN (${guids.map(() => '?').join(',')})`,
    guids,
  );
  if (!rows.length) return out;
  const ords = await db.query<{ note_id: number; ord: number }>(
    `SELECT note_id, ord FROM cards WHERE note_id IN (${rows.map(() => '?').join(',')})`,
    rows.map((r) => r.id),
  );
  for (const r of rows) {
    out.set(r.guid, {
      id: Number(r.id),
      noteTypeId: Number(r.note_type_id),
      fields: JSON.parse(r.fields),
      tags: decodeTags(r.tags),
      ords: new Set(ords.filter((o) => Number(o.note_id) === Number(r.id)).map((o) => Number(o.ord))),
    });
  }
  return out;
}

/** True when the package carries any review progress (Anki's "Include scheduling information"). */
async function hasScheduling(staging: StagingSource): Promise<boolean> {
  const [row] = await staging.query<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM revlog) + (SELECT COUNT(*) FROM card WHERE type != 0 OR reps > 0) AS n`,
  );
  return Number(row?.n ?? 0) > 0;
}

interface Setup {
  report: ReportBuilder;
  decks: DeckPlan;
  noteTypes: NoteType[];
  presets: { id: number; name: string; config: PresetConfig }[];
  media: ReturnType<typeof planMedia>;
  ctx: Omit<PlanContext, 'existing'>;
  counts: { notes: number; cards: number; revlog: number };
  hasScheduling: boolean;
  sourceFormat: string;
  sourceSha256: string;
}

/** Reads Atlas and the staging file and decides everything except the notes themselves. Writes nothing. */
async function setUp(db: Db, staging: StagingSource, now: number, updateExisting: boolean): Promise<Setup> {
  const report = new ReportBuilder();
  const meta = await readMeta(staging);
  const counts = await countRows(staging);
  const scheduled = await hasScheduling(staging);
  if (!scheduled && counts.cards > 0) report.warn('no-scheduling');

  const [decks, configs, existingPresets, settings] = await Promise.all([
    readDecks(staging), readDeckConfigs(staging), listPresets(db), getSettings(db),
  ]);
  const deckPlan = planDecks({
    decks, configs, homeDeckCounts: await homeDeckCounts(staging), existingDecks: await listDecks(db), existingPresets,
    useDeckConfigs: scheduled, deckIds: idsFrom((await maxOf(db, `SELECT MAX(id) AS m FROM decks`)) + 1),
    presetIds: idsFrom((await maxOf(db, `SELECT MAX(id) AS m FROM presets`)) + 1), now,
  }, report);
  const typePlan = planNoteTypes(
    await readNoteTypes(staging), await listNoteTypes(db), idsFrom((await maxOf(db, `SELECT MAX(id) AS m FROM note_types`)) + 1), report,
  );
  const existingMedia = await db.query<{ name: string; sha1: string }>(`SELECT name, sha1 FROM media`);
  const media = planMedia(await readMedia(staging), existingMedia);
  if (media.renamedForCollision.length) {
    for (const name of media.renamedForCollision) report.warn('renamed-media', name);
  }
  // Templates and CSS of new note types may name media too.
  const noteTypes = typePlan.create.map((t) => ({
    ...t,
    css: rewriteReferences(t.css, media.renames),
    templates: t.templates.map((x) => ({
      ...x, front: rewriteReferences(x.front, media.renames), back: rewriteReferences(x.back, media.renames),
    })),
  }));

  // Steps come from the card's Anki options when the file has them, since `left` counts Anki's steps.
  const configOfDeck = new Map<number, SDeckConfig>();
  const configById = new Map(configs.map((c) => [c.id, c]));
  for (const d of decks) if (d.configId !== null && configById.has(d.configId)) configOfDeck.set(d.id, configById.get(d.configId)!);
  const presetById = new Map([...existingPresets, ...deckPlan.presets].map((p) => [p.id, p.config]));
  const deckPreset = new Map<number, number>([
    ...(await listDecks(db)).map((d) => [d.id, d.presetId] as [number, number]),
    ...deckPlan.create.map((d) => [d.id, d.presetId] as [number, number]),
  ]);

  const [range] = await staging.query<{ lo: number | null; hi: number | null }>(`SELECT MIN(id) AS lo, MAX(id) AS hi FROM revlog`);
  const taken = range?.lo == null
    ? []
    : (await db.query<{ id: number }>(`SELECT id FROM revlog WHERE id BETWEEN ? AND ?`, [range.lo, Number(range.hi) + counts.revlog]))
        .map((r) => Number(r.id));

  const ctx: Omit<PlanContext, 'existing'> = {
    now,
    dayStartHour: settings.dayStartHour,
    ankiToday: ankiToday({ crtSecs: meta.ankiCrt, rolloverHour: meta.ankiRolloverHour, creationOffsetMin: meta.ankiCreationOffset }, now),
    decks: deckPlan,
    types: { ...typePlan, typeFor: new Map([...typePlan.typeFor].map(([k, t]) => [k, noteTypes.find((n) => n.id === t.id) ?? t])) },
    stepsFor(home, atlasDeck) {
      const c = configOfDeck.get(home);
      if (c && scheduled) return { learn: c.learnStepsMin.length, relearn: c.relearnStepsMin.length };
      const p = presetById.get(deckPreset.get(atlasDeck) ?? 1) ?? DEFAULT_PRESET;
      return { learn: p.learningSteps.length, relearn: p.relearningSteps.length };
    },
    noteIds: idsFrom((await maxOf(db, `SELECT MAX(id) AS m FROM notes`)) + 1),
    cardIds: idsFrom((await maxOf(db, `SELECT MAX(id) AS m FROM cards`)) + 1),
    revlogIds: new RevlogIds(new Set(taken)),
    newPositionBase: await maxOf(db, `SELECT MAX(new_position) AS m FROM cards`),
    media: { renames: media.renames, known: media.known },
    missingSeen: new Set(),
    updateExisting,
  };
  return {
    report, decks: deckPlan, noteTypes, presets: deckPlan.presets, media, ctx, counts, hasScheduling: scheduled,
    sourceFormat: meta.sourceFormat, sourceSha256: meta.sourceSha256,
  };
}

export interface ImportPreview {
  sourceFormat: string;
  counts: { notes: number; cards: number; reviews: number; media: number };
  hasScheduling: boolean;
  /** Notes in the file that Atlas already has; they'll be left as they are. */
  existingNotes: number;
  newDecks: string[];
  newNoteTypes: string[];
  warnings: ImportWarning[];
}

/** What an import would do, without writing anything. */
export async function previewImport(db: Db, staging: StagingSource, now: number): Promise<ImportPreview> {
  const s = await setUp(db, staging, now, false);
  // Only guids are needed here; reading whole chunks would double the work on a big deck.
  let existingNotes = 0;
  for (let after = Number.MIN_SAFE_INTEGER; ;) {
    const rows = await staging.query<{ id: number; guid: string }>(
      `SELECT id, guid FROM note WHERE id > ? ORDER BY id LIMIT ?`, [after, DEFAULT_CHUNK],
    );
    if (!rows.length) break;
    const guids = rows.map((r) => String(r.guid));
    const [found] = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM notes WHERE guid IN (${guids.map(() => '?').join(',')})`, guids,
    );
    existingNotes += Number(found?.n ?? 0);
    after = Number(rows[rows.length - 1]!.id);
  }
  const paths = (id: number): string => {
    const d = s.decks.create.find((x) => x.id === id);
    if (!d) return '';
    const parent = d.parentId === null ? '' : paths(d.parentId);
    return parent ? `${parent}::${d.name}` : d.name;
  };
  return {
    sourceFormat: s.sourceFormat,
    counts: { notes: s.counts.notes, cards: s.counts.cards, reviews: s.counts.revlog, media: (await readMedia(staging)).length },
    hasScheduling: s.hasScheduling,
    existingNotes,
    newDecks: s.decks.create.map((d) => paths(d.id) || d.name),
    newNoteTypes: s.noteTypes.map((t) => t.name),
    warnings: s.report.build(s.sourceFormat, 0).warnings,
  };
}

/** Imports a staged package. Throws ImportCancelled, ImportBusyError, BackupFailedError or IntegrityError. */
export async function runImport(
  db: Db,
  staging: StagingSource,
  platform: ImportPlatform,
  options: ImportOptions,
): Promise<ImportReport> {
  if (running) throw new ImportBusyError();
  running = true;
  const started = options.clock.now();
  const progress = (stage: ImportStage, done: number, total: number) => options.onProgress?.({ stage, done, total });
  const checkCancel = () => {
    if (options.signal?.aborted) throw new ImportCancelled();
  };
  let batchId: number | null = null;
  try {
    checkCancel();
    progress('backup', 0, 1);
    let backupPath: string;
    try {
      backupPath = await platform.backup();
    } catch (e) {
      throw new BackupFailedError(e);
    }
    checkCancel();
    progress('setup', 0, 1);
    const now = options.clock.now();
    const s = await setUp(db, staging, now, options.updateExisting ?? false);
    const { report } = s;

    const created = await db.execute(
      `INSERT INTO import_batches (source_name, source_sha256, imported_at, state) VALUES (?, ?, ?, 'running')`,
      [options.sourceName, s.sourceSha256, now],
    );
    batchId = created.lastInsertId;
    const batch = batchId;

    // Decks, presets, note types and media rows first: notes refer to them.
    await db.batch([
      ...insertRows('presets', ['id', 'name', 'config', 'import_batch_id'], s.presets.map((p) => [p.id, p.name, JSON.stringify(p.config), batch])),
      ...insertRows(
        'decks',
        ['id', 'name', 'parent_id', 'preset_id', 'colour', 'position', 'created_at', 'import_batch_id'],
        s.decks.create.map((d) => [d.id, d.name, d.parentId, d.presetId, d.colour, d.position, d.createdAt, batch]),
      ),
      ...insertRows(
        'note_types',
        ['id', 'name', 'kind', 'builtin', 'fields', 'templates', 'css', 'created_at', 'updated_at', 'import_batch_id'],
        s.noteTypes.map((t) => [t.id, t.name, t.kind, null, JSON.stringify(t.fields), JSON.stringify(t.templates), t.css, now, now, batch]),
      ),
      ...insertRows('media', ['name', 'sha1', 'size', 'import_batch_id'], s.media.install.map((m) => [m.name, m.sha1, m.size, batch])),
    ]);
    report.imported.decks = s.decks.create.length;
    report.imported.media = s.media.install.length;

    checkCancel();
    progress('media', 0, s.media.install.length);
    // Rows go in before files, so a crash in between still lets recovery find and delete the files.
    if (s.media.install.length) await platform.installMedia(s.media.install);
    progress('media', s.media.install.length, s.media.install.length);

    let done = 0;
    progress('notes', 0, s.counts.notes);
    for await (const chunk of noteChunks(staging, options.chunkSize ?? DEFAULT_CHUNK)) {
      checkCancel();
      const ctx: PlanContext = { ...s.ctx, existing: await existingByGuid(db, chunk.notes.map((n) => n.guid)) };
      const plan = planChunk(chunk, ctx, report);
      const backups = plan.noteUpdates.length
        ? await db.query<{ id: number; fields: string; sort_field: string; tags: string; updated_at: number }>(
            `SELECT id, fields, sort_field, tags, updated_at FROM notes WHERE id IN (${plan.noteUpdates.map(() => '?').join(',')})`,
            plan.noteUpdates.map((n) => n.id),
          )
        : [];
      await db.batch([
        ...insertRows(
          'import_note_backups',
          ['import_batch_id', 'note_id', 'fields', 'sort_field', 'tags', 'updated_at'],
          backups.map((b) => [batch, b.id, b.fields, b.sort_field, b.tags, b.updated_at]),
        ),
        ...plan.noteUpdates.map((n) => ({
          sql: `UPDATE notes SET fields = ?, sort_field = ?, tags = ?, updated_at = ? WHERE id = ?`,
          params: [JSON.stringify(n.fields), n.sortField, encodeTags(n.tags), n.updatedAt, n.id],
        })),
        ...insertRows('notes', NOTE_COLUMNS, plan.notes.map((n) => noteRow(n, batch))),
        ...insertRows('cards', ['id', ...CARD_COLUMNS, 'import_batch_id'], plan.cards.map((c) => cardRow(c, batch))),
        ...insertRows('revlog', REVLOG_COLUMNS, plan.revlog.map(revlogRow)),
      ]);
      done += chunk.notes.length;
      progress('notes', done, s.counts.notes);
    }

    checkCancel();
    progress('checking', 0, 1);
    const [qc] = await db.query<{ quick_check: string }>(`PRAGMA quick_check`);
    const fk = await db.query(`PRAGMA foreign_key_check`);
    if (String(qc?.quick_check) !== 'ok' || fk.length) {
      throw new IntegrityError(`quick_check: ${qc?.quick_check}; foreign key problems: ${fk.length}`);
    }

    const result = { ...report.build(s.sourceFormat, options.clock.now() - started), backupPath };
    const changed = result.imported.notes + result.imported.cards + result.imported.decks + result.imported.media +
      result.updatedNotes + s.noteTypes.length + s.presets.length > 0;
    await db.batch(
      changed
        ? [
            { sql: `DELETE FROM import_note_backups WHERE import_batch_id = ?`, params: [batch] },
            { sql: `UPDATE import_batches SET state = 'complete', summary = ? WHERE id = ?`, params: [JSON.stringify(result), batch] },
          ]
        : // Importing a file that's already here leaves no trace at all.
          [{ sql: `DELETE FROM import_batches WHERE id = ?`, params: [batch] }],
    );
    batchId = null;
    progress('checking', 1, 1);
    return result;
  } catch (e) {
    if (batchId !== null) await rollbackBatch(db, platform, batchId);
    throw e;
  } finally {
    running = false;
  }
}

/** Removes everything one import added and restores notes it updated. */
export async function rollbackBatch(db: Db, platform: ImportPlatform, batchId: number): Promise<void> {
  const media = await db.query<{ name: string }>(`SELECT name FROM media WHERE import_batch_id = ?`, [batchId]);
  // Files first: if this is interrupted, the batch is still recorded and the next launch finishes it.
  if (media.length) await platform.removeMedia(media.map((m) => m.name));
  const p = [batchId];
  await db.batch([
    {
      sql: `UPDATE notes SET
              fields = (SELECT b.fields FROM import_note_backups b WHERE b.import_batch_id = ? AND b.note_id = notes.id),
              sort_field = (SELECT b.sort_field FROM import_note_backups b WHERE b.import_batch_id = ? AND b.note_id = notes.id),
              tags = (SELECT b.tags FROM import_note_backups b WHERE b.import_batch_id = ? AND b.note_id = notes.id),
              updated_at = (SELECT b.updated_at FROM import_note_backups b WHERE b.import_batch_id = ? AND b.note_id = notes.id)
            WHERE id IN (SELECT note_id FROM import_note_backups WHERE import_batch_id = ?)`,
      params: [batchId, batchId, batchId, batchId, batchId],
    },
    // Cards and reviews of imported notes go with them (ON DELETE CASCADE).
    { sql: `DELETE FROM notes WHERE import_batch_id = ?`, params: p },
    // Cards the import added to notes Atlas already had.
    { sql: `DELETE FROM cards WHERE import_batch_id = ?`, params: p },
    { sql: `DELETE FROM decks WHERE import_batch_id = ?`, params: p },
    { sql: `DELETE FROM note_types WHERE import_batch_id = ?`, params: p },
    { sql: `DELETE FROM presets WHERE import_batch_id = ?`, params: p },
    { sql: `DELETE FROM media WHERE import_batch_id = ?`, params: p },
    { sql: `DELETE FROM import_note_backups WHERE import_batch_id = ?`, params: p },
    { sql: `DELETE FROM import_batches WHERE id = ?`, params: p },
  ]);
}

/** Run on launch: undoes any import that was cut off (app closed, crash, power cut). Returns how many. */
export async function recoverInterruptedImports(db: Db, platform: ImportPlatform): Promise<number> {
  const rows = await db.query<{ id: number }>(`SELECT id FROM import_batches WHERE state = 'running' ORDER BY id`);
  for (const r of rows) await rollbackBatch(db, platform, Number(r.id));
  return rows.length;
}

/** Whether an import is running in this window (the UI stays locked meanwhile). */
export function importRunning(): boolean {
  return running;
}
