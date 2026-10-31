import type { RevlogEntry } from '../core/model';
import type { Db, Statement } from './db';
import { toRevlog } from './rows';

export function revlogInsertStatement(e: RevlogEntry): Statement {
  return {
    sql: `INSERT INTO revlog (id, card_id, rating, state_before, due_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, kind)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [e.id, e.cardId, e.rating, e.stateBefore, e.dueBefore, e.stability, e.difficulty, e.elapsedDays, e.scheduledDays, e.durationMs, e.kind],
  };
}

/** Revlog ids are answer times in ms, bumped past the last id so two quick answers never collide. */
export async function nextRevlogId(db: Db, now: number): Promise<number> {
  const [row] = await db.query<{ m: number | null }>(`SELECT MAX(id) AS m FROM revlog`);
  return Math.max(now, (row?.m ?? 0) + 1);
}

export async function revlogForCard(db: Db, cardId: number): Promise<RevlogEntry[]> {
  return (await db.query(`SELECT * FROM revlog WHERE card_id = ? ORDER BY id`, [cardId])).map(toRevlog);
}
