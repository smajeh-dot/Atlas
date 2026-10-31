import type { BuiltinNoteType, NoteType } from '../core/model';
import type { Db } from './db';
import { toNoteType } from './rows';

export async function listNoteTypes(db: Db): Promise<NoteType[]> {
  return (await db.query(`SELECT * FROM note_types ORDER BY id`)).map(toNoteType);
}

export async function getNoteType(db: Db, id: number): Promise<NoteType> {
  const [row] = await db.query(`SELECT * FROM note_types WHERE id = ?`, [id]);
  if (!row) throw new Error(`Note type ${id} does not exist`);
  return toNoteType(row);
}

export async function getBuiltinNoteType(db: Db, builtin: BuiltinNoteType): Promise<NoteType> {
  const [row] = await db.query(`SELECT * FROM note_types WHERE builtin = ? ORDER BY id LIMIT 1`, [builtin]);
  if (!row) throw new Error(`Built-in note type ${builtin} is missing`);
  return toNoteType(row);
}
