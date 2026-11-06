import { beforeEach, describe, expect, test } from 'vitest';
import { SCHEMA_VERSION, migrate, pendingUpgrade } from '../../src/data/migrations';
import { updateSettings } from '../../src/data/settings';
import type { BackupInfo, BackupKind, BackupPort } from '../../src/platform/backupBridge';
import { createBackupService, SafetyBackupError } from '../../src/services/backupService';
import { UndoStack } from '../../src/services/undo';
import type { Db } from '../../src/data/db';
import { MIN, fixedClock } from '../helpers/fixtures';
import { seedDeck, seedNote } from '../helpers/seed';
import { createMigratedDb, createTestDb } from '../helpers/testDb';

/** A local-time instant, so the "same day" rules are tested the way a person lives them. */
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

function setup(start: number) {
  const clock = fixedClock(start);
  const files: BackupInfo[] = [];
  const created: BackupKind[] = [];
  const restored: { name: string; maxVersion: number }[] = [];
  let failing = false;
  const port: BackupPort = {
    async create(kind) {
      if (failing) throw new Error('disk full');
      created.push(kind);
      const info = { name: `${kind}-${clock.now()}.db`, kind, createdAt: clock.now(), sizeBytes: 1000 };
      files.push(info);
      return info;
    },
    async list() {
      return [...files].sort((a, b) => b.createdAt - a.createdAt);
    },
    async restore(name, maxVersion) {
      restored.push({ name, maxVersion });
    },
  };
  return { clock, files, created, restored, port, fail: (v: boolean) => (failing = v) };
}

async function withNote(db: Db, clock: { now(): number }) {
  const deps = { db, clock, undo: new UndoStack() };
  const deckId = await seedDeck(db, 'Chemistry');
  await seedNote(deps, deckId, 'basic', ['H2O', 'water']);
}

describe('daily backup', () => {
  let s: ReturnType<typeof setup>;
  let db: Db;
  beforeEach(async () => {
    s = setup(at(6, 9));
    db = await createMigratedDb();
    await withNote(db, s.clock);
  });
  const service = () => createBackupService({ port: s.port, db, clock: s.clock });

  test('makes one when there is none', async () => {
    await service().ensureDaily();
    expect(s.created).toEqual(['daily']);
  });

  test('makes only one per calendar day, and another after midnight', async () => {
    const svc = service();
    await svc.ensureDaily();
    s.clock.advance(at(6, 22) - at(6, 9));
    await svc.ensureDaily();
    expect(s.created).toEqual(['daily']);
    s.clock.advance(at(7, 0, 5) - at(6, 22));
    await svc.ensureDaily();
    expect(s.created).toEqual(['daily', 'daily']);
  });

  test('a manual or pre-delete backup does not count as the daily one', async () => {
    s.files.push({ name: 'manual-1.db', kind: 'manual', createdAt: at(6, 8), sizeBytes: 1 });
    await service().ensureDaily();
    expect(s.created).toEqual(['daily']);
  });

  test('does nothing when Automatic backups is off', async () => {
    await updateSettings(db, { autoBackup: false });
    await service().ensureDaily();
    expect(s.created).toEqual([]);
  });

  test('does nothing for a database with no notes', async () => {
    const empty = await createMigratedDb();
    await createBackupService({ port: s.port, db: empty, clock: s.clock }).ensureDaily();
    expect(s.created).toEqual([]);
  });

  test('a failure is swallowed, never thrown', async () => {
    s.fail(true);
    await expect(service().ensureDaily()).resolves.toBeUndefined();
  });
});

describe('before a delete', () => {
  let s: ReturnType<typeof setup>;
  let db: Db;
  beforeEach(async () => {
    s = setup(at(6, 9));
    db = await createMigratedDb();
    await withNote(db, s.clock);
  });
  const service = () => createBackupService({ port: s.port, db, clock: s.clock });

  test('backs up first', async () => {
    await service().beforeDelete();
    expect(s.created).toEqual(['pre-delete']);
  });

  test('is skipped when Automatic backups is off', async () => {
    await updateSettings(db, { autoBackup: false });
    await service().beforeDelete();
    expect(s.created).toEqual([]);
  });

  test('is skipped when there is nothing to protect', async () => {
    const empty = await createMigratedDb();
    await createBackupService({ port: s.port, db: empty, clock: s.clock }).beforeDelete();
    expect(s.created).toEqual([]);
  });

  test('backs up at most once every ten minutes', async () => {
    const svc = service();
    await svc.beforeDelete();
    s.clock.advance(9 * MIN);
    await svc.beforeDelete();
    expect(s.created).toEqual(['pre-delete']);
    s.clock.advance(2 * MIN);
    await svc.beforeDelete();
    expect(s.created).toEqual(['pre-delete', 'pre-delete']);
  });

  test('a failure stops the delete with a plain message', async () => {
    s.fail(true);
    const err = await service().beforeDelete().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SafetyBackupError);
    expect((err as Error).message).toBe(
      "Atlas couldn't make a safety backup first, so nothing was changed. Check there's free space and try again.",
    );
  });

  test('a failed attempt does not start the ten-minute quiet period', async () => {
    s.fail(true);
    await service().beforeDelete().catch(() => undefined);
    s.fail(false);
    await service().beforeDelete();
    expect(s.created).toEqual(['pre-delete']);
  });
});

describe('before an upgrade', () => {
  test('does nothing for a brand-new database', async () => {
    const s = setup(at(6, 9));
    const db = createTestDb();
    expect(await pendingUpgrade(db)).toBeNull();
    await createBackupService({ port: s.port, db, clock: s.clock }).beforeUpgrade();
    expect(s.created).toEqual([]);
  });

  test('does nothing when the data is already current', async () => {
    const s = setup(at(6, 9));
    const db = await createMigratedDb();
    expect(await pendingUpgrade(db)).toBeNull();
    await createBackupService({ port: s.port, db, clock: s.clock }).beforeUpgrade();
    expect(s.created).toEqual([]);
  });

  test('backs up first when an older database is about to be upgraded, even with the switch off', async () => {
    const s = setup(at(6, 9));
    const db = createTestDb();
    await migrate(db, at(6, 9), 1);
    await updateSettings(db, { autoBackup: false });
    expect(await pendingUpgrade(db)).toEqual({ from: 1, to: SCHEMA_VERSION });
    await createBackupService({ port: s.port, db, clock: s.clock }).beforeUpgrade();
    expect(s.created).toEqual(['pre-upgrade']);
  });

  test('a failure stops the upgrade', async () => {
    const s = setup(at(6, 9));
    const db = createTestDb();
    await migrate(db, at(6, 9), 1);
    s.fail(true);
    await expect(createBackupService({ port: s.port, db, clock: s.clock }).beforeUpgrade()).rejects.toBeInstanceOf(SafetyBackupError);
  });
});

describe('manual backup, listing and restore', () => {
  test('Back up now works with the switch off and no notes', async () => {
    const s = setup(at(6, 9));
    const db = await createMigratedDb();
    await updateSettings(db, { autoBackup: false });
    const info = await createBackupService({ port: s.port, db, clock: s.clock }).backupNow();
    expect(info.kind).toBe('manual');
    expect(s.created).toEqual(['manual']);
  });

  test('Back up now reports a failure rather than hiding it', async () => {
    const s = setup(at(6, 9));
    const db = await createMigratedDb();
    s.fail(true);
    await expect(createBackupService({ port: s.port, db, clock: s.clock }).backupNow()).rejects.toThrow('disk full');
  });

  test('the last backup is the newest of any kind, or null', async () => {
    const s = setup(at(6, 9));
    const db = await createMigratedDb();
    const svc = createBackupService({ port: s.port, db, clock: s.clock });
    expect(await svc.lastBackup()).toBeNull();
    s.files.push({ name: 'daily-1.db', kind: 'daily', createdAt: at(5, 9), sizeBytes: 1 });
    s.files.push({ name: 'pre-import-1.db', kind: 'pre-import', createdAt: at(6, 7), sizeBytes: 1 });
    expect((await svc.lastBackup())?.name).toBe('pre-import-1.db');
    expect((await svc.list()).map((b) => b.name)).toEqual(['pre-import-1.db', 'daily-1.db']);
  });

  test('restoring asks for the newest format Atlas knows, then upgrades the restored data', async () => {
    const s = setup(at(6, 9));
    const db = createTestDb();
    await migrate(db, at(6, 9), 1); // stands in for an older backup that has just been swapped in
    await createBackupService({ port: s.port, db, clock: s.clock }).restore('daily-123.db');
    expect(s.restored).toEqual([{ name: 'daily-123.db', maxVersion: SCHEMA_VERSION }]);
    expect(await pendingUpgrade(db)).toBeNull();
  });

  test('a refused restore passes the reason on and upgrades nothing', async () => {
    const s = setup(at(6, 9));
    const db = createTestDb();
    await migrate(db, at(6, 9), 1);
    s.port.restore = async () => {
      throw new Error('That backup was made by a newer version of Atlas. Update Atlas to restore it.');
    };
    await expect(createBackupService({ port: s.port, db, clock: s.clock }).restore('x.db')).rejects.toThrow('newer version');
    expect(await pendingUpgrade(db)).toEqual({ from: 1, to: SCHEMA_VERSION });
  });
});
