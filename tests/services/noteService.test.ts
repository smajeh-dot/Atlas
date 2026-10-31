import { beforeEach, expect, test } from 'vitest';
import { addNote, deleteNote, findDuplicates, NoCardsError, updateNote, type NoteServiceDeps } from '../../src/services/noteService';
import { UndoStack } from '../../src/services/undo';
import { normaliseTags, getNote } from '../../src/data/notes';
import { cardsOfNote } from '../../src/data/cards';
import { revlogForCard } from '../../src/data/revlog';
import { getBuiltinNoteType } from '../../src/data/noteTypes';
import { createDeck } from '../../src/data/decks';
import { createMigratedDb } from '../helpers/testDb';
import { fixedClock, T0 } from '../helpers/fixtures';

let deps: NoteServiceDeps;
let deck: number;
let basic: number;
let reversed: number;

beforeEach(async () => {
  const db = await createMigratedDb();
  deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  deck = await createDeck(db, { name: 'Biology' }, T0);
  basic = (await getBuiltinNoteType(db, 'basic')).id;
  reversed = (await getBuiltinNoteType(db, 'basic_reversed')).id;
});

test('a Basic note makes one new card', async () => {
  const r = await addNote(deps, { noteTypeId: basic, deckId: deck, fields: ['<b>Osmosis</b>', 'Water moves'], tags: ['cells'] });
  const cards = await cardsOfNote(deps.db, r.noteId);
  expect(cards).toHaveLength(1);
  expect(cards[0]!.state).toBe(0);
  expect(cards[0]!.deckId).toBe(deck);
  const note = await getNote(deps.db, r.noteId);
  expect(note.sortField).toBe('Osmosis');
  expect(note.tags).toEqual(['cells']);
  expect(note.guid).toMatch(/[0-9a-f-]{36}/);
});

test('cards of one note share a new position; the next note is one later', async () => {
  const a = await addNote(deps, { noteTypeId: reversed, deckId: deck, fields: ['dog', 'chien'], tags: [] });
  const b = await addNote(deps, { noteTypeId: basic, deckId: deck, fields: ['cat', 'chat'], tags: [] });
  const ca = await cardsOfNote(deps.db, a.noteId);
  const cb = await cardsOfNote(deps.db, b.noteId);
  expect(ca.map((c) => c.ord)).toEqual([0, 1]);
  expect(ca[0]!.newPosition).toBe(ca[1]!.newPosition);
  expect(cb[0]!.newPosition).toBe(ca[0]!.newPosition! + 1);
});

test('a note that makes no cards is refused', async () => {
  await expect(addNote(deps, { noteTypeId: basic, deckId: deck, fields: ['', 'A'], tags: [] })).rejects.toBeInstanceOf(NoCardsError);
});

test('updating a reversed note with a new back adds card 2 and never deletes cards', async () => {
  const a = await addNote(deps, { noteTypeId: reversed, deckId: deck, fields: ['dog', ''], tags: [] });
  const r = await updateNote(deps, a.noteId, { fields: ['dog', 'chien'], tags: ['french'] });
  expect(r.addedCardIds).toHaveLength(1);
  const cards = await cardsOfNote(deps.db, a.noteId);
  expect(cards.map((c) => c.ord)).toEqual([0, 1]);
  await updateNote(deps, a.noteId, { fields: ['dog', ''], tags: [] });
  expect(await cardsOfNote(deps.db, a.noteId)).toHaveLength(2);
  expect((await getNote(deps.db, a.noteId)).tags).toEqual([]);
});

test('duplicates match the same type and plain text, ignoring case', async () => {
  const a = await addNote(deps, { noteTypeId: basic, deckId: deck, fields: ['<b>Osmosis</b>', 'x'], tags: [] });
  expect(await findDuplicates(deps.db, basic, 'osmosis')).toEqual([a.noteId]);
  expect(await findDuplicates(deps.db, basic, 'osmosis', a.noteId)).toEqual([]);
  expect(await findDuplicates(deps.db, reversed, 'osmosis')).toEqual([]);
});

test('undo of add deletes the note', async () => {
  const a = await addNote(deps, { noteTypeId: basic, deckId: deck, fields: ['Q', 'A'], tags: [] });
  const entry = deps.undo.pop()!;
  expect(entry.label).toBe('add card');
  await deps.db.batch(entry.restore);
  expect(await deps.db.query('SELECT id FROM notes WHERE id = ?', [a.noteId])).toHaveLength(0);
});

test('delete then undo restores the note, cards and review history with the same ids', async () => {
  const a = await addNote(deps, { noteTypeId: reversed, deckId: deck, fields: ['dog', 'chien'], tags: ['fr'] });
  const [c0] = await cardsOfNote(deps.db, a.noteId);
  await deps.db.execute(
    `INSERT INTO revlog (id, card_id, rating, state_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, kind) VALUES (?, ?, 3, 0, 1, 5, 0, 0, 4000, 0)`,
    [T0, c0!.id],
  );
  const before = { note: await getNote(deps.db, a.noteId), cards: await cardsOfNote(deps.db, a.noteId), rev: await revlogForCard(deps.db, c0!.id) };
  await deleteNote(deps, a.noteId);
  expect(await deps.db.query('SELECT id FROM cards')).toHaveLength(0);
  const entry = deps.undo.pop()!;
  expect(entry.label).toBe('delete note');
  await deps.db.batch(entry.restore);
  expect(await getNote(deps.db, a.noteId)).toEqual(before.note);
  expect(await cardsOfNote(deps.db, a.noteId)).toEqual(before.cards);
  expect(await revlogForCard(deps.db, c0!.id)).toEqual(before.rev);
});

test('tags are trimmed, spaces become underscores, duplicates dropped ignoring case', () => {
  expect(normaliseTags(['Paper 1', 'paper_1', ' x ', ''])).toEqual(['Paper_1', 'x']);
});
