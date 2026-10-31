import { beforeEach, expect, test } from 'vitest';
import { StudySession, type SessionDeps } from '../../src/services/studySession';
import { addNote } from '../../src/services/noteService';
import { UndoStack } from '../../src/services/undo';
import { planStudy } from '../../src/services/deckService';
import { createDeck } from '../../src/data/decks';
import { getBuiltinNoteType } from '../../src/data/noteTypes';
import { getCard } from '../../src/data/cards';
import { studyDay } from '../../src/core/studyDay';
import { createMigratedDb } from '../helpers/testDb';
import { DAY, fixedClock, T0 } from '../helpers/fixtures';

let deps: SessionDeps;
let deck: number;
let ids: number[];

beforeEach(async () => {
  const db = await createMigratedDb();
  deps = { db, clock: fixedClock(T0), undo: new UndoStack() };
  deck = await createDeck(db, { name: 'Physics' }, T0);
  const basic = (await getBuiltinNoteType(db, 'basic')).id;
  ids = [];
  for (const q of ['a', 'b']) ids.push((await addNote(deps, { noteTypeId: basic, deckId: deck, fields: [q, 'x'], tags: [] })).cardIds[0]!);
});

test('bury hides the card until tomorrow and can be undone', async () => {
  const s = await StudySession.start(deps, deck);
  await s.buryCurrent();
  const c = await getCard(deps.db, ids[0]!);
  expect(c.buriedDay).toBe(studyDay(T0, 4));
  expect(c.buriedKind).toBe('manual');
  expect(s.current()!.card.id).toBe(ids[1]);
  expect((await planStudy(deps.db, deck, T0)).newCards.map((x) => x.id)).toEqual([ids[1]]);
  expect((await planStudy(deps.db, deck, T0 + DAY)).newCards.map((x) => x.id)).toContain(ids[0]);
  expect(await s.undo()).toBe('bury');
  expect((await getCard(deps.db, ids[0]!)).buriedDay).toBeNull();
  expect(s.current()!.card.id).toBe(ids[0]);
});

test('suspend removes the card from study and can be undone', async () => {
  const s = await StudySession.start(deps, deck);
  await s.suspendCurrent();
  expect((await getCard(deps.db, ids[0]!)).suspended).toBe(true);
  expect(s.remaining().new).toBe(1);
  expect(await s.undo()).toBe('suspend');
  expect((await getCard(deps.db, ids[0]!)).suspended).toBe(false);
  expect(s.remaining().new).toBe(2);
});

test('flags are set, cleared and undone without leaving the card', async () => {
  const s = await StudySession.start(deps, deck);
  await s.setFlag(3);
  expect((await getCard(deps.db, ids[0]!)).flag).toBe(3);
  expect(s.current()!.card.id).toBe(ids[0]);
  expect(s.current()!.card.flag).toBe(3);
  await s.setFlag(0);
  expect((await getCard(deps.db, ids[0]!)).flag).toBe(0);
  expect(await s.undo()).toBe('flag');
  expect((await getCard(deps.db, ids[0]!)).flag).toBe(3);
});

test('actions with no current card do nothing', async () => {
  const empty = await createDeck(deps.db, { name: 'Empty' }, T0);
  const s = await StudySession.start(deps, empty);
  await s.buryCurrent();
  await s.suspendCurrent();
  await s.setFlag(2);
  expect(deps.undo.size).toBe(2); // only the two "add card" entries
});
