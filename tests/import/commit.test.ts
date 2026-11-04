import { describe, expect, test } from 'vitest';
import type { Db, Statement } from '../../src/data/db';
import { createDeck } from '../../src/data/decks';
import {
  BackupFailedError, ImportBusyError, ImportCancelled, previewImport, recoverInterruptedImports, runImport,
  type ImportOptions, type ImportPlatform,
} from '../../src/import/commit';
import type { MediaInstall } from '../../src/import/media';
import { getDueCandidates } from '../../src/services/deckService';
import { addNote } from '../../src/services/noteService';
import { UndoStack } from '../../src/services/undo';
import { createMigratedDb } from '../helpers/testDb';
import { fixedClock } from '../helpers/fixtures';
import { expected, staged } from './helpers';

const NOW = 1793821483999; // when rich-modern was exported (see its expected.json)

class FakePlatform implements ImportPlatform {
  files = new Map<string, string>();
  backups = 0;
  failBackup = false;
  failInstall = false;
  async installMedia(files: MediaInstall[]) {
    if (this.failInstall) throw new Error('disk full');
    for (const f of files) this.files.set(f.name, f.sha1);
  }
  async removeMedia(names: string[]) {
    for (const n of names) this.files.delete(n);
  }
  async backup() {
    if (this.failBackup) throw new Error('no space');
    this.backups++;
    return 'backups/pre-import.db';
  }
}

const options = (extra: Partial<ImportOptions> = {}): ImportOptions => ({
  sourceName: 'Chemistry.apkg', clock: fixedClock(NOW), ...extra,
});

const TABLES = [
  'meta', 'presets', 'decks', 'note_types', 'notes', 'cards', 'revlog', 'media', 'import_batches', 'import_note_backups',
];

async function dump(db: Db): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[t] = await db.query(`SELECT * FROM ${t} ORDER BY rowid`);
  return out;
}

/** An Atlas database that already has the student's own work in it. */
async function studentDb(): Promise<Db> {
  const db = await createMigratedDb();
  const deckId = await createDeck(db, { name: 'Physics' }, NOW - 1e9);
  const deps = { db, clock: fixedClock(NOW - 1e9), undo: new UndoStack() };
  const { cardIds } = await addNote(deps, { noteTypeId: 1, deckId, fields: ['F = ma', 'Newton 2'], tags: ['mechanics'] });
  await db.execute(
    `INSERT INTO revlog (id, card_id, rating, state_before, due_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, kind)
     VALUES (?, ?, 3, 0, NULL, 2, 5, 0, 1, 3000, 0)`,
    [NOW - 5e8, cardIds[0]],
  );
  await db.execute(`INSERT INTO media (name, sha1, size) VALUES ('own.png', 'abc', 3)`);
  return db;
}

/** Wraps a database so one write fails, as a full disk or a crash would. */
function failing(db: Db, at: { batch?: number; midBatch?: boolean; deadAfter?: number }): Db & { batches: number } {
  let batches = 0;
  let dead = false;
  const wrapped = {
    get batches() {
      return batches;
    },
    query: <T>(sql: string, params?: unknown[]) => (dead ? Promise.reject(new Error('gone')) : db.query<T>(sql, params)),
    execute: (sql: string, params?: unknown[]) => (dead ? Promise.reject(new Error('gone')) : db.execute(sql, params)),
    async batch(statements: Statement[]) {
      if (dead) throw new Error('gone');
      batches++;
      if (at.deadAfter !== undefined && batches > at.deadAfter) {
        dead = true;
        throw new Error('power cut');
      }
      if (batches === at.batch) {
        if (!at.midBatch) throw new Error('disk full');
        const half = Math.floor(statements.length / 2);
        // A bad statement halfway through: the transaction must undo the first half too.
        return db.batch([...statements.slice(0, half), { sql: 'INSERT INTO no_such_table VALUES (1)' }, ...statements.slice(half)]);
      }
      return db.batch(statements);
    },
  };
  return wrapped;
}

describe('a full import', () => {
  test('brings every deck, note, card, review and media file into Atlas', async () => {
    const db = await createMigratedDb();
    const platform = new FakePlatform();
    const exp = await expected('rich-modern');
    const report = await runImport(db, staged('rich-modern'), platform, options());
    expect(report.imported).toEqual({ decks: 6, notes: exp.notes.length, cards: exp.cards.length, reviews: exp.revlog.length, media: 5 });
    const count = async (t: string) => Number((await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))[0]!.n);
    expect(await count('notes')).toBe(exp.notes.length);
    expect(await count('cards')).toBe(exp.cards.length);
    expect(await count('revlog')).toBe(exp.revlog.length);
    expect([...platform.files.keys()].sort()).toEqual(['_bg-tile.png', 'benzene.mp3', 'benzene.png', 'café.png', 'flask.png']);
    expect(platform.backups).toBe(1);
    const [batch] = await db.query<{ state: string; summary: string }>(`SELECT state, summary FROM import_batches`);
    expect(batch!.state).toBe('complete');
    expect(JSON.parse(batch!.summary).imported.notes).toBe(exp.notes.length);
    expect(await db.query(`PRAGMA foreign_key_check`)).toEqual([]);
  });

  test('imported cards are ready to study: overdue reviews are due now, suspended ones are not', async () => {
    const db = await createMigratedDb();
    await runImport(db, staged('rich-modern'), new FakePlatform(), options());
    const decks = await db.query<{ id: number }>(`SELECT id FROM decks`);
    const due = await getDueCandidates(db, decks.map((d) => d.id), NOW, 4);
    const fronts = async (cards: { noteId: number }[]) =>
      (await Promise.all(cards.map(async (c) => (await db.query<{ sort_field: string }>(`SELECT sort_field FROM notes WHERE id = ?`, [c.noteId]))[0]!.sort_field))).sort();
    // 06 was buried in Anki; burying is a same-day thing and isn't carried over, so it's due like any other.
    expect(await fronts(due.reviewCards)).toEqual(['State card 04', 'State card 05', 'State card 06', 'State card 07']);
    expect(await fronts(due.intradayLearning)).toEqual(['State card 02', 'State card 09']);
  });

  test('importing the same file twice changes nothing the second time', async () => {
    const db = await studentDb();
    await runImport(db, staged('rich-modern'), new FakePlatform(), options());
    const once = await dump(db);
    const second = await runImport(db, staged('rich-modern'), new FakePlatform(), options());
    expect(second.imported).toEqual({ decks: 0, notes: 0, cards: 0, reviews: 0, media: 0 });
    expect(second.skipped.existingNotes).toBe(30);
    expect(await dump(db)).toEqual(once);
  });

  test('a card deleted since the last import comes back, and nothing else changes', async () => {
    const db = await createMigratedDb();
    await runImport(db, staged('rich-modern'), new FakePlatform(), options());
    const [na] = await db.query<{ id: number }>(`SELECT id FROM notes WHERE sort_field = 'Na'`);
    await db.execute(`DELETE FROM cards WHERE note_id = ? AND ord = 1`, [na!.id]);
    const report = await runImport(db, staged('rich-modern'), new FakePlatform(), options());
    expect(report.imported).toMatchObject({ notes: 0, cards: 1 });
    expect(await db.query(`SELECT ord FROM cards WHERE note_id = ? ORDER BY ord`, [na!.id])).toEqual([{ ord: 0 }, { ord: 1 }]);
  });

  test('chunk size changes nothing about the result', async () => {
    // Fresh databases: a student's own note would have a random guid and differ for that reason alone.
    const a = await createMigratedDb();
    const b = await createMigratedDb();
    await runImport(a, staged('rich-modern'), new FakePlatform(), options({ chunkSize: 1 }));
    await runImport(b, staged('rich-modern'), new FakePlatform(), options({ chunkSize: 500 }));
    const strip = (d: Record<string, unknown[]>) => ({ ...d, import_batches: d.import_batches!.map((r) => ({ ...(r as object), summary: null })) });
    expect(strip(await dump(a))).toEqual(strip(await dump(b)));
  });

  test('a file with no scheduling says so, and every card is new', async () => {
    const db = await createMigratedDb();
    const report = await runImport(db, staged('rich-modern-nosched'), new FakePlatform(), options());
    expect(report.warnings.map((w) => w.code)).toContain('no-scheduling');
    expect(await db.query(`SELECT DISTINCT state FROM cards`)).toEqual([{ state: 0 }]);
    expect(report.imported.reviews).toBe(0);
  });

  test('FSRS memory comes across exactly', async () => {
    const db = await createMigratedDb();
    await runImport(db, staged('fsrs-modern'), new FakePlatform(), options());
    const [card] = await db.query<{ stability: number; difficulty: number }>(
      `SELECT c.stability, c.difficulty FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.sort_field = 'Ion 1'`,
    );
    expect(card).toEqual({ stability: 67.1525, difficulty: 2.09 });
  });
});

describe('when an import fails, Atlas is left exactly as it was', () => {
  test('a failure at any write, or halfway through one, undoes everything', async () => {
    const probe = failing(await studentDb(), {});
    await runImport(probe, staged('rich-modern'), new FakePlatform(), options({ chunkSize: 4 }));
    const writes = probe.batches;
    expect(writes).toBeGreaterThan(5);
    for (let k = 1; k <= writes; k++) {
      for (const midBatch of [false, true]) {
        const db = await studentDb();
        const platform = new FakePlatform();
        platform.files.set('own.png', 'abc');
        const before = await dump(db);
        await expect(runImport(failing(db, { batch: k, midBatch }), staged('rich-modern'), platform, options({ chunkSize: 4 }))).rejects.toThrow();
        expect(await dump(db), `write ${k}${midBatch ? ' (midway)' : ''}`).toEqual(before);
        expect([...platform.files.keys()]).toEqual(['own.png']);
      }
    }
  });

  test('a failure copying media undoes everything', async () => {
    const db = await studentDb();
    const before = await dump(db);
    const platform = new FakePlatform();
    platform.failInstall = true;
    await expect(runImport(db, staged('rich-modern'), platform, options())).rejects.toThrow('disk full');
    expect(await dump(db)).toEqual(before);
  });

  test('if the backup fails, nothing is written at all', async () => {
    const db = await studentDb();
    const before = await dump(db);
    const platform = new FakePlatform();
    platform.failBackup = true;
    await expect(runImport(db, staged('rich-modern'), platform, options())).rejects.toBeInstanceOf(BackupFailedError);
    expect(await dump(db)).toEqual(before);
  });

  test('Cancel stops within one chunk and undoes everything', async () => {
    const db = await studentDb();
    const before = await dump(db);
    const controller = new AbortController();
    let chunksAfterCancel = 0;
    const run = runImport(db, staged('rich-modern'), new FakePlatform(), options({
      chunkSize: 2,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.stage !== 'notes' || p.done === 0) return;
        if (controller.signal.aborted) chunksAfterCancel++;
        controller.abort();
      },
    }));
    await expect(run).rejects.toBeInstanceOf(ImportCancelled);
    expect(chunksAfterCancel).toBe(0);
    expect(await dump(db)).toEqual(before);
  });

  test('updated notes get their old text back', async () => {
    const db = await createMigratedDb();
    await runImport(db, staged('rich-modern'), new FakePlatform(), options());
    await db.execute(`UPDATE notes SET fields = '["Na","my own words"]', sort_field = 'Na' WHERE sort_field = 'Na'`);
    const before = await dump(db);
    const flaky = failing(db, { batch: 3 });
    await expect(runImport(flaky, staged('rich-modern'), new FakePlatform(), options({ updateExisting: true, chunkSize: 100 }))).rejects.toThrow();
    expect(await dump(db)).toEqual(before);
    // And when it succeeds, the text is refreshed but the card's progress isn't touched.
    const progress = await db.query(`SELECT * FROM cards ORDER BY id`);
    const report = await runImport(db, staged('rich-modern'), new FakePlatform(), options({ updateExisting: true }));
    expect(report.updatedNotes).toBe(1);
    expect(await db.query(`SELECT fields FROM notes WHERE sort_field = 'Na'`)).toEqual([{ fields: '["Na","Sodium"]' }]);
    expect(await db.query(`SELECT * FROM cards ORDER BY id`)).toEqual(progress);
  });

  test('if Atlas is closed mid-import, the next launch undoes it', async () => {
    const db = await studentDb();
    const before = await dump(db);
    const platform = new FakePlatform();
    platform.files.set('own.png', 'abc');
    // The "power cut" also stops the import from cleaning up after itself.
    const dying = failing(db, { deadAfter: 3 });
    await expect(runImport(dying, staged('rich-modern'), platform, options({ chunkSize: 4 }))).rejects.toThrow();
    expect(await db.query(`SELECT state FROM import_batches`)).toEqual([{ state: 'running' }]);
    expect(platform.files.size).toBeGreaterThan(1);

    expect(await recoverInterruptedImports(db, platform)).toBe(1);
    expect(await dump(db)).toEqual(before);
    expect([...platform.files.keys()]).toEqual(['own.png']);
    expect(await recoverInterruptedImports(db, platform)).toBe(0);
  });

  test('only one import runs at a time', async () => {
    const db = await createMigratedDb();
    const first = runImport(db, staged('rich-modern'), new FakePlatform(), options());
    await expect(runImport(db, staged('rich-modern'), new FakePlatform(), options())).rejects.toBeInstanceOf(ImportBusyError);
    await first;
  });
});

describe('preview', () => {
  test('describes the file without writing anything, and knows what Atlas already has', async () => {
    const db = await studentDb();
    const before = await dump(db);
    const p = await previewImport(db, staged('rich-modern'), NOW);
    expect(await dump(db)).toEqual(before);
    expect(p).toMatchObject({ sourceFormat: 'modern', hasScheduling: true, existingNotes: 0 });
    expect(p.counts).toEqual({ notes: 30, cards: 35, reviews: 53, media: 5 });
    expect(p.newDecks).toContain('Chem::Organic::Alkanes');
    expect(p.newNoteTypes).toContain('Cloze (imported)');
    await runImport(db, staged('rich-modern'), new FakePlatform(), options());
    const again = await previewImport(db, staged('rich-modern'), NOW);
    expect(again.existingNotes).toBe(30);
    expect(again.newDecks).toEqual([]);
  });
});

describe('media, end to end', () => {
  test('a clashing name is renamed everywhere it is used; an identical file is shared, never copied or deleted', async () => {
    const db = await createMigratedDb();
    const exp = JSON.parse(await (await import('node:fs/promises')).readFile(
      new URL('../fixtures/anki/rich-modern.expected.json', import.meta.url), 'utf8')) as { media: { name: string; sha1: string }[] };
    const benzene = exp.media.find((m) => m.name === 'benzene.png')!;
    const tile = exp.media.find((m) => m.name === '_bg-tile.png')!;
    // Atlas already has the same benzene.png, and a different file called _BG-tile.png.
    await db.execute(`INSERT INTO media (name, sha1, size) VALUES ('benzene.png', ?, 69), ('_BG-tile.png', 'different', 9)`, [benzene.sha1]);
    const before = await db.query(`SELECT * FROM media ORDER BY name`);
    const platform = new FakePlatform();
    const report = await runImport(db, staged('rich-modern'), platform, options());

    const renamed = `_bg-tile-${tile.sha1.slice(0, 8)}.png`;
    expect([...platform.files.keys()].sort()).toEqual([renamed, 'benzene.mp3', 'café.png', 'flask.png'].sort());
    expect(report.warnings.find((w) => w.code === 'renamed-media')!.examples).toEqual(['_bg-tile.png']);
    // The CSS of the imported note type now points at the renamed file.
    const [type] = await db.query<{ css: string }>(`SELECT css FROM note_types WHERE name = 'Chem Reaction'`);
    expect(type!.css).toContain(`url('${renamed}')`);
    expect(type!.css).not.toContain(`url('_bg-tile.png')`);
    // The note that shows benzene.png still names it, and no copy was made.
    const [note] = await db.query<{ fields: string }>(`SELECT fields FROM notes WHERE sort_field LIKE '%Name this ring%'`);
    expect(note!.fields).toContain('<img src=\\"benzene.png\\">');

    // Undoing the import removes only what it added: the shared benzene.png stays.
    const batch = Number((await db.query<{ id: number }>(`SELECT id FROM import_batches`))[0]!.id);
    const { rollbackBatch } = await import('../../src/import/commit');
    await rollbackBatch(db, platform, batch);
    expect(await db.query(`SELECT * FROM media ORDER BY name`)).toEqual(before);
    expect(platform.files.size).toBe(0);
  });
});
