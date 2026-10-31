import type { BuiltinNoteType } from '../../src/core/model';
import type { Db } from '../../src/data/db';
import { createDeck } from '../../src/data/decks';
import { getBuiltinNoteType } from '../../src/data/noteTypes';
import { addNote, type NoteServiceDeps } from '../../src/services/noteService';
import { DAY, T0 } from './fixtures';

export function seedDeck(db: Db, name: string, parentId: number | null = null): Promise<number> {
  return createDeck(db, { name, parentId }, T0);
}

export async function seedNote(
  deps: NoteServiceDeps,
  deckId: number,
  type: Exclude<BuiltinNoteType, 'image_occlusion'>,
  fields: string[],
  tags: string[] = [],
): Promise<{ noteId: number; cardIds: number[] }> {
  const t = await getBuiltinNoteType(deps.db, type);
  return addNote(deps, { noteTypeId: t.id, deckId, fields, tags });
}

/** Turns a card into a review card due at `dueAt`, as if it had been studied before. */
export async function makeReview(
  db: Db,
  cardId: number,
  opts: { dueAt: number; scheduledDays?: number; lapses?: number; stability?: number },
): Promise<void> {
  const ivl = opts.scheduledDays ?? 10;
  await db.execute(
    `UPDATE cards SET state = 2, due_at = ?, new_position = NULL, stability = ?, difficulty = 5, scheduled_days = ?,
     reps = 10, lapses = ?, last_review_at = ? WHERE id = ?`,
    [opts.dueAt, opts.stability ?? 5, ivl, opts.lapses ?? 0, opts.dueAt - ivl * DAY, cardId],
  );
}

export async function countRows(db: Db, table: string): Promise<number> {
  const [r] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(r?.n ?? 0);
}
