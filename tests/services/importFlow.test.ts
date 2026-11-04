import { expect, test } from 'vitest';
import type { Db } from '../../src/data/db';
import type { ImportPlatform } from '../../src/import/commit';
import { ImportFlow, type ImportFlowDeps, type ImportStep } from '../../src/services/importFlow';
import { createMigratedDb } from '../helpers/testDb';
import { fixedClock } from '../helpers/fixtures';
import { staged } from '../import/helpers';

const NOW = 1793821483999;

function setup(db: Db, overrides: Partial<ImportFlowDeps> = {}) {
  const steps: ImportStep[] = [];
  let finished = 0;
  const platform: ImportPlatform = {
    installMedia: async () => {},
    removeMedia: async () => {},
    backup: async () => 'C:\\Users\\me\\AppData\\Roaming\\Atlas\\backups\\pre-import-1.db',
  };
  const deps: ImportFlowDeps = {
    db, staging: staged('rich-modern'), platform, clock: fixedClock(NOW),
    chooseFile: async () => 'C:\\Users\\me\\Downloads\\Chemistry.apkg',
    prepare: async () => ({}),
    finish: async () => {
      finished++;
    },
    ...overrides,
  };
  const flow = new ImportFlow(deps, (s) => steps.push(s));
  return { flow, steps, finished: () => finished };
}

test('choose → preview → import → report, cleaning up the work folder at the end', async () => {
  const db = await createMigratedDb();
  const { flow, steps, finished } = setup(db);
  await flow.choose();
  expect(steps.map((s) => s.kind)).toEqual(['reading', 'preview']);
  expect(flow.step).toMatchObject({ kind: 'preview', fileName: 'Chemistry.apkg', preview: { counts: { notes: 30 } } });

  await flow.start();
  expect(flow.step.kind).toBe('done');
  const stages = steps.filter((s) => s.kind === 'importing').map((s) => (s as { progress: { stage: string } }).progress.stage);
  expect(new Set(stages)).toEqual(new Set(['backup', 'setup', 'media', 'notes', 'checking']));
  if (flow.step.kind !== 'done') throw new Error('not done');
  expect(flow.step.report.imported.notes).toBe(30);
  expect(flow.step.report.backupPath).toContain('pre-import');
  expect(finished()).toBe(1);
});

test('choosing nothing changes nothing', async () => {
  const { flow, steps } = setup(await createMigratedDb(), { chooseFile: async () => null });
  await flow.choose();
  expect(steps).toEqual([]);
  expect(flow.step.kind).toBe('idle');
});

test("a file Atlas can't read shows the reader's own message", async () => {
  const message = "This file was exported in a way Atlas can't read. In Anki, export again and tick 'Support older Anki versions'.";
  const { flow, finished } = setup(await createMigratedDb(), { prepare: async () => { throw new Error(message); } });
  await flow.choose();
  expect(flow.step).toEqual({ kind: 'failed', fileName: 'Chemistry.apkg', message, cancelled: false });
  expect(finished()).toBe(1);
});

test('Cancel undoes the import and says so', async () => {
  const db = await createMigratedDb();
  const { flow } = setup(db);
  await flow.choose();
  const run = flow.start();
  flow.cancel();
  expect(flow.step).toMatchObject({ kind: 'importing', cancelling: true });
  await run;
  expect(flow.step).toMatchObject({ kind: 'failed', cancelled: true, message: 'The import was cancelled. Nothing was changed.' });
  expect(await db.query(`SELECT * FROM notes`)).toEqual([]);
});

test('the rest of Atlas is locked while reading or importing, and the flow ignores repeat clicks', async () => {
  const db = await createMigratedDb();
  let release!: () => void;
  const { flow } = setup(db, { prepare: () => new Promise((r) => (release = () => r({}))) });
  const choosing = flow.choose();
  await Promise.resolve();
  await Promise.resolve();
  expect(flow.busy).toBe(true);
  await flow.choose(); // ignored
  await flow.close(); // ignored
  expect(flow.step.kind).toBe('reading');
  release();
  await choosing;
  expect(flow.busy).toBe(false);
  await flow.close();
  expect(flow.step.kind).toBe('idle');
});
