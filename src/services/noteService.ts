import { cardOrdsForNote } from '../core/cards';
import { stripHtml } from '../core/html';
import type { Card, Note } from '../core/model';
import { cardInsertStatement, cardsOfNote } from '../data/cards';
import type { Db, Statement } from '../data/db';
import { getNoteType } from '../data/noteTypes';
import { getNote, normaliseTags, noteInsertStatement, noteUpdateStatement } from '../data/notes';
import { revlogForCard, revlogInsertStatement } from '../data/revlog';
import type { UndoEntry, UndoStack } from './undo';

export { normaliseTags } from '../data/notes';

export class NoCardsError extends Error {}

export interface NoteServiceDeps {
  db: Db;
  clock: { now(): number };
  undo: UndoStack;
}

async function nextId(db: Db, table: 'notes' | 'cards'): Promise<number> {
  const [row] = await db.query<{ m: number | null }>(`SELECT MAX(id) AS m FROM ${table}`);
  return (row?.m ?? 0) + 1;
}

function newCard(noteId: number, ord: number, deckId: number, newPosition: number, now: number): Omit<Card, 'id'> {
  return {
    noteId, ord, deckId, originalDeckId: null, state: 0, dueAt: null, newPosition, stability: 0, difficulty: 0,
    scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, lastReviewAt: null, suspended: false, buriedDay: null,
    buriedKind: null, flag: 0, createdAt: now, updatedAt: now,
  };
}

export async function addNote(
  deps: NoteServiceDeps,
  input: { noteTypeId: number; deckId: number; fields: string[]; tags: string[] },
): Promise<{ noteId: number; cardIds: number[] }> {
  const { db } = deps;
  const now = deps.clock.now();
  const noteType = await getNoteType(db, input.noteTypeId);
  const ords = cardOrdsForNote(noteType, input.fields);
  if (!ords.length) throw new NoCardsError('This note would not make any cards. Fill in the first field, or add a cloze.');
  const noteId = await nextId(db, 'notes');
  const firstCardId = await nextId(db, 'cards');
  const [pos] = await db.query<{ m: number | null }>(`SELECT MAX(new_position) AS m FROM cards`);
  const newPosition = (pos?.m ?? 0) + 1;
  const note: Note = {
    id: noteId, guid: crypto.randomUUID(), noteTypeId: noteType.id, fields: input.fields,
    sortField: stripHtml(input.fields[0] ?? ''), tags: normaliseTags(input.tags), createdAt: now, updatedAt: now,
  };
  const cardIds = ords.map((_, i) => firstCardId + i);
  await db.batch([
    noteInsertStatement(note),
    ...ords.map((ord, i) => cardInsertStatement({ id: cardIds[i]!, ...newCard(noteId, ord, input.deckId, newPosition, now) })),
  ]);
  deps.undo.push({ label: 'add card', restore: [{ sql: `DELETE FROM notes WHERE id = ?`, params: [noteId] }] });
  return { noteId, cardIds };
}

/** Saves new field contents and tags. New templates or clozes get new cards; cards are never deleted here. */
export async function updateNote(
  deps: NoteServiceDeps,
  noteId: number,
  input: { fields: string[]; tags: string[] },
): Promise<{ addedCardIds: number[] }> {
  const { db } = deps;
  const now = deps.clock.now();
  const note = await getNote(db, noteId);
  const noteType = await getNoteType(db, note.noteTypeId);
  const existing = await cardsOfNote(db, noteId);
  const have = new Set(existing.map((c) => c.ord));
  const missing = cardOrdsForNote(noteType, input.fields).filter((o) => !have.has(o));
  const first = existing[0];
  const firstCardId = await nextId(db, 'cards');
  const addedCardIds = missing.map((_, i) => firstCardId + i);
  const [pos] = await db.query<{ m: number | null }>(`SELECT MAX(new_position) AS m FROM cards`);
  const newPosition = first?.newPosition ?? (pos?.m ?? 0) + 1;
  const updated: Note = {
    ...note, fields: input.fields, sortField: stripHtml(input.fields[0] ?? ''), tags: normaliseTags(input.tags), updatedAt: now,
  };
  const statements: Statement[] = [
    noteUpdateStatement(updated),
    ...missing.map((ord, i) =>
      cardInsertStatement({ id: addedCardIds[i]!, ...newCard(noteId, ord, first?.deckId ?? 1, newPosition, now) }),
    ),
  ];
  await db.batch(statements);
  return { addedCardIds };
}

export async function deleteNote(deps: NoteServiceDeps, noteId: number): Promise<UndoEntry> {
  const { db } = deps;
  const note = await getNote(db, noteId);
  const cards = await cardsOfNote(db, noteId);
  const revlog = (await Promise.all(cards.map((c) => revlogForCard(db, c.id)))).flat();
  await db.execute(`DELETE FROM notes WHERE id = ?`, [noteId]);
  const entry: UndoEntry = {
    label: 'delete note',
    restore: [noteInsertStatement(note), ...cards.map((c) => cardInsertStatement(c)), ...revlog.map(revlogInsertStatement)],
  };
  deps.undo.push(entry);
  return entry;
}

export async function findDuplicates(db: Db, noteTypeId: number, firstField: string, excludeNoteId?: number): Promise<number[]> {
  const text = stripHtml(firstField).toLowerCase();
  if (!text) return [];
  const rows = await db.query<{ id: number }>(
    `SELECT id FROM notes WHERE note_type_id = ? AND lower(sort_field) = ? AND id != ? ORDER BY id`,
    [noteTypeId, text, excludeNoteId ?? -1],
  );
  return rows.map((r) => r.id);
}

/** The deck holding the first card of the first possible duplicate, or null when there is none. */
export async function findDuplicateDeck(db: Db, noteTypeId: number, firstField: string, excludeNoteId?: number): Promise<number | null> {
  const [noteId] = await findDuplicates(db, noteTypeId, firstField, excludeNoteId);
  if (noteId === undefined) return null;
  const [card] = await cardsOfNote(db, noteId);
  return card ? card.deckId : null;
}
