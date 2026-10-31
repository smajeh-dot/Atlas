import { DEFAULT_PRESET, type Card } from '../core/model';
import { answerCard } from '../core/scheduler';
import type { Db } from '../data/db';
import { SCHEMA_VERSION } from '../data/migrations';

export interface SelfCheckResult {
  ok: boolean;
  schemaVersion: number;
  integrity: string;
  decks: number;
  notes: number;
  cards: number;
  schedulerOk: boolean;
}

async function count(db: Db, table: string): Promise<number> {
  try {
    const [r] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
    return Number(r?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Read-only health check shown on start-up: database integrity, schema version and a dry-run of the scheduler. */
export async function runSelfCheck(db: Db, now: number): Promise<SelfCheckResult> {
  const [qc] = await db.query<{ quick_check: string }>(`PRAGMA quick_check`);
  const integrity = String(qc?.quick_check ?? 'no result');
  let schemaVersion = 0;
  try {
    const [v] = await db.query<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`);
    schemaVersion = v ? Number(v.value) : 0;
  } catch {
    schemaVersion = 0;
  }
  const probe: Card = {
    id: 1, noteId: 1, ord: 0, deckId: 1, originalDeckId: null, state: 0, dueAt: null, newPosition: 1, stability: 0,
    difficulty: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, lastReviewAt: null, suspended: false,
    buriedDay: null, buriedKind: null, flag: 0, createdAt: now, updatedAt: now,
  };
  const o = answerCard(probe, now, 3, DEFAULT_PRESET);
  const schedulerOk = o.card.state === 1 && o.card.dueAt === now + 10 * 60_000;
  return {
    ok: integrity === 'ok' && schemaVersion === SCHEMA_VERSION && schedulerOk,
    schemaVersion,
    integrity,
    decks: await count(db, 'decks'),
    notes: await count(db, 'notes'),
    cards: await count(db, 'cards'),
    schedulerOk,
  };
}
