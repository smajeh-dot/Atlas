/**
 * Imports a 50,000-note, 100,000-card, 500,000-review package and records how
 * long it takes and how much memory it uses. Target: about a minute, with
 * memory that doesn't grow with the size of the deck.
 *
 * Run with: npm run test:scale
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { runImport, type ImportPlatform } from '../../src/import/commit';
import { createMigratedDb } from '../helpers/testDb';
import { fixedClock } from '../helpers/fixtures';

const NOTES = 50_000;
const CARDS_PER_NOTE = 2;
const REVIEWS_PER_CARD = 5;
const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 10, 4, 12);

const schema = readFileSync(
  fileURLToPath(new URL('../../src-tauri/crates/anki-package/staging.sql', import.meta.url)),
  'utf8',
);

/** A staging database shaped like the Rust reader's output for a big, well-used deck. */
function bigStaging(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const crt = Math.floor((NOW - 1000 * DAY_MS) / 1000);
  db.exec('BEGIN');
  const meta = db.prepare('INSERT INTO meta VALUES (?, ?)');
  for (const [k, v] of Object.entries({
    staging_version: '1', source_format: 'modern', source_sha256: 'x', anki_schema: '18', anki_crt: String(crt),
    anki_rollover_hour: '4', anki_creation_offset: '0', anki_sched_ver: '2',
  })) meta.run(k, v);
  db.prepare('INSERT INTO deck VALUES (1, ?, 0, 1)').run('Default');
  db.prepare('INSERT INTO deck VALUES (2, ?, 0, 1)').run('Chemistry::Big');
  db.prepare(`INSERT INTO deck_config VALUES (1, 'Default', 20, 200, '[1.0,10.0]', '[10.0]', 0.9)`).run();
  db.prepare(`INSERT INTO notetype VALUES (5, 'Basic (and reversed card)', 'standard', 2, '', 0)`).run();
  db.prepare(`INSERT INTO field VALUES (5, 0, 'Front'), (5, 1, 'Back')`).run();
  db.prepare(`INSERT INTO template VALUES (5, 0, 'Card 1', '{{Front}}', '{{FrontSide}}<hr id=answer>{{Back}}'),
    (5, 1, 'Card 2', '{{Back}}', '{{FrontSide}}<hr id=answer>{{Front}}')`).run();
  const note = db.prepare('INSERT INTO note VALUES (?, ?, 5, ?, ?, ?)');
  const card = db.prepare('INSERT INTO card VALUES (?, ?, 2, 0, ?, 2, 2, ?, ?, 2500, ?, 0, 0, 0, 0, NULL, NULL, NULL, NULL, NULL, NULL)');
  const rev = db.prepare('INSERT INTO revlog VALUES (?, ?, 3, ?, ?, 2500, 6000, 1)');
  let revId = NOW - 900 * DAY_MS;
  for (let n = 0; n < NOTES; n++) {
    const noteId = NOW - 950 * DAY_MS + n;
    note.run(noteId, `guid-${n}`, Math.floor(noteId / 1000), '["chem"]', JSON.stringify([`Question ${n} <b>bold</b>`, `Answer ${n}`]));
    for (let o = 0; o < CARDS_PER_NOTE; o++) {
      const cardId = noteId * 2 + o;
      card.run(cardId, noteId, o, 1000 + (n % 120) - 20, 3 + (n % 60), REVIEWS_PER_CARD);
      let ivl = 1;
      for (let r = 0; r < REVIEWS_PER_CARD; r++) {
        rev.run(revId++, cardId, ivl, Math.max(0, ivl - 2));
        ivl *= 2;
      }
    }
  }
  db.exec('COMMIT');
  return db;
}

const platform: ImportPlatform = {
  installMedia: async () => {},
  removeMedia: async () => {},
  backup: async () => 'backup',
};

test('a 50,000-note deck with 500,000 reviews imports in about a minute with flat memory', async () => {
  const builtAt = performance.now();
  const raw = bigStaging();
  const staging = {
    async query<T>(sql: string, params: unknown[] = []) {
      const bound = params.map((p) => (typeof p === 'number' && Number.isInteger(p) ? BigInt(p) : p)) as never[];
      return raw.prepare(sql).all(...bound).map((r) => ({ ...r })) as T[];
    },
  };
  const db = await createMigratedDb();
  const buildMs = performance.now() - builtAt;

  global.gc?.();
  const heapAtStart = process.memoryUsage().heapUsed;
  let peakHeap = heapAtStart;
  const heapAtProgress: number[] = [];
  const started = performance.now();
  const report = await runImport(db, staging, platform, {
    sourceName: 'big.apkg',
    clock: fixedClock(NOW),
    onProgress: (p) => {
      const h = process.memoryUsage().heapUsed;
      peakHeap = Math.max(peakHeap, h);
      if (p.stage === 'notes' && p.done % 10_000 === 0) heapAtProgress.push(h);
    },
  });
  const seconds = (performance.now() - started) / 1000;

  const mb = (b: number) => Math.round(b / 1024 / 1024);
  console.log(
    `[scale] staging built in ${(buildMs / 1000).toFixed(1)} s; import took ${seconds.toFixed(1)} s; ` +
      `heap ${mb(heapAtStart)} → peak ${mb(peakHeap)} MB; heap every 10,000 notes: ${heapAtProgress.map(mb).join(', ')} MB; ` +
      `rss ${mb(process.memoryUsage().rss)} MB`,
  );

  expect(report.imported).toMatchObject({ notes: NOTES, cards: NOTES * CARDS_PER_NOTE, reviews: NOTES * CARDS_PER_NOTE * REVIEWS_PER_CARD });
  expect(seconds).toBeLessThan(90);
  // The importer holds one chunk at a time: the heap mustn't grow with the deck.
  // (The in-memory test database itself lives outside the JS heap.)
  expect(peakHeap - heapAtStart).toBeLessThan(400 * 1024 * 1024);
});
