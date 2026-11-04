import { beforeEach, expect, test } from 'vitest';
import { StudySession, type SessionDeps } from '../../src/services/studySession';
import { updateNote } from '../../src/services/noteService';
import { UndoStack } from '../../src/services/undo';
import { createMigratedDb } from '../helpers/testDb';
import { fixedClock, T0 } from '../helpers/fixtures';
import { countRows, seedDeck, seedNote } from '../helpers/seed';

let deps: SessionDeps & { clock: ReturnType<typeof fixedClock> };
let deck: number;
beforeEach(async () => {
  deps = { db: await createMigratedDb(), clock: fixedClock(T0), undo: new UndoStack() };
  deck = await seedDeck(deps.db, 'Chemistry');
});

test('summary counts answers, time and Again, and undo takes one back', async () => {
  await seedNote(deps, deck, 'basic', ['a', 'x']);
  await seedNote(deps, deck, 'basic', ['b', 'x']);
  const s = await StudySession.start(deps, deck);
  expect(s.summary()).toEqual({ answers: 0, durationMs: 0, again: 0 });
  await s.answer(1, 4000, s.current()!.card.id);
  await s.answer(3, 90_000, s.current()!.card.id);
  expect(s.summary()).toEqual({ answers: 2, durationMs: 64_000, again: 1 });
  await s.undo();
  expect(s.summary()).toEqual({ answers: 1, durationMs: 4000, again: 1 });
});

test('current() carries deckName and unknownFilters', async () => {
  const sub = await seedDeck(deps.db, 'Organic', deck);
  const { noteId } = await seedNote(deps, sub, 'basic', ['q', 'a']);
  const typeId = (await deps.db.query<{ note_type_id: number }>(`SELECT note_type_id FROM notes WHERE id = ?`, [noteId]))[0]!.note_type_id;
  await deps.db.execute(`UPDATE note_types SET templates = ? WHERE id = ?`, [
    JSON.stringify([{ name: 'Card 1', front: '{{foo:Front}}', back: '{{Back}}' }]), typeId,
  ]);
  const s = await StudySession.start(deps, deck);
  expect(s.current()!.deckName).toBe('Chemistry › Organic');
  expect(s.current()!.unknownFilters).toEqual(['foo']);
});

test('refreshCard shows edited text and a new deck without restarting', async () => {
  await seedNote(deps, deck, 'basic', ['before', 'x']);
  const other = await seedDeck(deps.db, 'Physics');
  const s = await StudySession.start(deps, deck);
  const { note, card } = s.current()!;
  await updateNote(deps, note.id, { fields: ['changed', 'x'], tags: [] });
  await deps.db.execute(`UPDATE cards SET deck_id = ? WHERE id = ?`, [other, card.id]);
  await s.refreshCard(card.id);
  expect(s.current()!.question).toContain('changed');
  expect(s.current()!.deckName).toBe('Physics');
});

test('deleteCurrentNote removes every card of the note and undo brings it back on screen', async () => {
  const { noteId, cardIds } = await seedNote(deps, deck, 'basic_reversed', ['dog', 'chien']);
  await seedNote(deps, deck, 'basic', ['other', 'x']);
  const s = await StudySession.start(deps, deck);
  expect(s.current()!.card.id).toBe(cardIds[0]);
  const before = s.remaining().new;
  await s.deleteCurrentNote();
  expect(await countRows(deps.db, 'notes')).toBe(1);
  expect(s.remaining().new).toBe(before - 1);
  expect(s.current()!.note.id).not.toBe(noteId);
  expect(await s.undo()).toBe('delete note');
  expect(await countRows(deps.db, 'notes')).toBe(2);
  expect(s.current()!.card.id).toBe(cardIds[0]);
});
