import type { Db } from '../data/db';
import { SCHEMA_VERSION, migrate, pendingUpgrade } from '../data/migrations';
import { getSettings } from '../data/settings';
import type { BackupInfo, BackupPort } from '../platform/backupBridge';

/** After one safety backup before a delete, the next delete within this long does not make another. */
const QUIET_MS = 10 * 60_000;

/** Thrown when a backup that had to come first could not be made, so the action was not done. */
export class SafetyBackupError extends Error {
  constructor(cause?: unknown) {
    super("Atlas couldn't make a safety backup first, so nothing was changed. Check there's free space and try again.", { cause });
  }
}

export interface BackupService {
  /** The first launch of each day makes a `daily` backup. Does nothing when Automatic backups is off. Never throws. */
  ensureDaily(): Promise<void>;
  /** Call before deleting a deck or a note. Throws SafetyBackupError, and the delete must not go ahead. */
  beforeDelete(): Promise<void>;
  /** Call before upgrading the data format. Throws SafetyBackupError, and the upgrade must not run. */
  beforeUpgrade(): Promise<void>;
  /** The Back up now button: always works, whatever the switch says. */
  backupNow(): Promise<BackupInfo>;
  /** Newest first. */
  list(): Promise<BackupInfo[]>;
  lastBackup(): Promise<BackupInfo | null>;
  /** Puts a backup back, then upgrades it if it came from an older Atlas. The caller reloads the screens. */
  restore(name: string): Promise<void>;
}

/** The local calendar day of a moment, as one comparable number. */
function dayKey(ms: number): number {
  const d = new Date(ms);
  return d.getFullYear() * 10_000 + d.getMonth() * 100 + d.getDate();
}

export function createBackupService(deps: { port: BackupPort; db: Db; clock: { now(): number } }): BackupService {
  const { port, db, clock } = deps;

  const switchedOn = async () => (await getSettings(db)).autoBackup;
  // A database with no notes holds nothing worth protecting.
  const hasNotes = async () => {
    const [row] = await db.query<{ n: number }>(`SELECT EXISTS(SELECT 1 FROM notes) AS n`);
    return Number(row?.n ?? 0) === 1;
  };
  const listOrEmpty = () => port.list().catch((): BackupInfo[] => []);
  const protect = async (kind: 'pre-delete' | 'pre-upgrade') => {
    try {
      await port.create(kind);
    } catch (e) {
      throw new SafetyBackupError(e);
    }
  };

  return {
    async ensureDaily() {
      try {
        if (!(await switchedOn()) || !(await hasNotes())) return;
        const today = dayKey(clock.now());
        const done = (await port.list()).some((b) => b.kind === 'daily' && dayKey(b.createdAt) === today);
        if (!done) await port.create('daily');
      } catch {
        // Silent by design: a missed daily backup is not worth interrupting anyone for.
      }
    },

    async beforeDelete() {
      if (!(await switchedOn()) || !(await hasNotes())) return;
      const now = clock.now();
      const recent = (await listOrEmpty()).some((b) => b.kind === 'pre-delete' && now - b.createdAt >= 0 && now - b.createdAt < QUIET_MS);
      if (!recent) await protect('pre-delete');
    },

    async beforeUpgrade() {
      if (await pendingUpgrade(db)) await protect('pre-upgrade');
    },

    backupNow: () => port.create('manual'),

    list: () => port.list(),

    async lastBackup() {
      const all = await port.list();
      return all.reduce<BackupInfo | null>((newest, b) => (!newest || b.createdAt > newest.createdAt ? b : newest), null);
    },

    async restore(name) {
      await port.restore(name, SCHEMA_VERSION);
      await migrate(db, clock.now());
    },
  };
}
