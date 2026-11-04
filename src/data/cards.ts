import type { Card } from '../core/model';
import type { Db, Statement } from './db';
import { toCard } from './rows';

export const CARD_COLUMNS = [
  'note_id', 'ord', 'deck_id', 'original_deck_id', 'state', 'due_at', 'new_position', 'stability', 'difficulty',
  'scheduled_days', 'learning_steps', 'reps', 'lapses', 'last_review_at', 'suspended', 'buried_day', 'buried_kind',
  'flag', 'created_at', 'updated_at',
] as const;

/** Column values in CARD_COLUMNS order. */
export function cardValues(c: Omit<Card, 'id'>): unknown[] {
  return [
    c.noteId, c.ord, c.deckId, c.originalDeckId, c.state, c.dueAt, c.state === 0 ? c.newPosition : null,
    c.stability, c.difficulty, c.scheduledDays, c.learningSteps, c.reps, c.lapses, c.lastReviewAt,
    c.suspended ? 1 : 0, c.buriedDay, c.buriedKind, c.flag, c.createdAt, c.updatedAt,
  ];
}

export async function getCard(db: Db, id: number): Promise<Card> {
  const [row] = await db.query(`SELECT * FROM cards WHERE id = ?`, [id]);
  if (!row) throw new Error(`Card ${id} does not exist`);
  return toCard(row);
}

export async function cardsOfNote(db: Db, noteId: number): Promise<Card[]> {
  return (await db.query(`SELECT * FROM cards WHERE note_id = ? ORDER BY ord`, [noteId])).map(toCard);
}

/** Writes every mutable column. new_position is cleared once a card leaves the new state. */
export function cardUpdateStatement(c: Card): Statement {
  return {
    sql: `UPDATE cards SET ${CARD_COLUMNS.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    params: [...cardValues(c), c.id],
  };
}

export function cardInsertStatement(c: Omit<Card, 'id'> & { id?: number }): Statement {
  const cols = c.id === undefined ? CARD_COLUMNS : (['id', ...CARD_COLUMNS] as const);
  const params = c.id === undefined ? cardValues(c) : [c.id, ...cardValues(c)];
  return { sql: `INSERT INTO cards (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, params };
}
