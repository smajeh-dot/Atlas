import type { Note } from '../core/model';
import type { Db, Statement } from './db';
import { encodeTags, toNote } from './rows';

export async function getNote(db: Db, id: number): Promise<Note> {
  const [row] = await db.query(`SELECT * FROM notes WHERE id = ?`, [id]);
  if (!row) throw new Error(`Note ${id} does not exist`);
  return toNote(row);
}

/** Tags are single words: spaces become underscores, and "Paper_1" and "paper_1" count as one tag. */
export function normaliseTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const clean = t.trim().replace(/\s+/g, '_');
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

export function noteInsertStatement(n: Note): Statement {
  return {
    sql: `INSERT INTO notes (id, guid, note_type_id, fields, sort_field, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [n.id, n.guid, n.noteTypeId, JSON.stringify(n.fields), n.sortField, encodeTags(n.tags), n.createdAt, n.updatedAt],
  };
}

export function noteUpdateStatement(n: Note): Statement {
  return {
    sql: `UPDATE notes SET fields = ?, sort_field = ?, tags = ?, updated_at = ? WHERE id = ?`,
    params: [JSON.stringify(n.fields), n.sortField, encodeTags(n.tags), n.updatedAt, n.id],
  };
}
