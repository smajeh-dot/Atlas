import { beforeEach, expect, test } from 'vitest';
import { mulberry32 } from '../../src/core/random';
import { createDeck, deleteDeck } from '../../src/data/decks';
import { CramSession, cramKey, type CramDeps } from '../../src/services/cramSession';
import { UndoStack } from '../../src/services/undo';
import { createMigratedDb } from '../helpers/testDb';
import { makeReview, seedDeck, seedNote } from '../helpers/seed';
import { DAY, fixedClock, T0 } from '../helpers/fixtures';

let deps: CramDeps & { undo: UndoStack };
let deck: number;

beforeEach(async () => {
  const db = await createMigratedDb();
  deps = { db, clock: fixedClock(T0), rng: mulberry32(1), undo: new UndoStack() };
  deck = await seedDeck(db, 'Chemistry');
});

async function addBasic(deckId: number, q: string, a = 'A'): Promise<number> {
  return (await seedNote(deps, deckId, 'basic', [q, a])).cardIds[0]!;
}

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

test('the pool includes subdecks, buried, new and not-due review cards, and excludes suspended ones', async () => {
  const sub = await seedDeck(deps.db, 'Organic', deck);
  const other = await seedDeck(deps.db, 'Physics');
  const a = await addBasic(deck, 'a');
  const inSub = await addBasic(sub, 'b');
  const buried = await addBasic(deck, 'c');
  const review = await addBasic(deck, 'd');
  const suspended = await addBasic(deck, 'e');
  await addBasic(other, 'elsewhere');
  await deps.db.execute(`UPDATE cards SET buried_day = 99999, buried_kind = 'manual' WHERE id = ?`, [buried]);
  await makeReview(deps.db, review, { dueAt: T0 + 30 * DAY });
  await deps.db.execute(`UPDATE cards SET suspended = 1 WHERE id = ?`, [suspended]);

  const s = await CramSession.open(deps, deck);
  expect(sorted(s.state().pool)).toEqual(sorted([a, inSub, buried, review]));
  expect(sorted(s.state().queue)).toEqual(sorted([a, inSub, buried, review]));
  expect(s.state().round).toBe(1);
});

test('all siblings of a reversed note are in the pool', async () => {
  const { cardIds } = await seedNote(deps, deck, 'basic_reversed', ['front', 'back']);
  expect(cardIds).toHaveLength(2);
  const s = await CramSession.open(deps, deck);
  expect(sorted(s.state().pool)).toEqual(sorted(cardIds));
});

test('current() is the front card, rendered for the deck', async () => {
  await addBasic(deck, 'Q', 'A');
  const s = await CramSession.open(deps, deck);
  const cur = s.current()!;
  expect(cur.card.id).toBe(s.state().queue[0]);
  expect(cur.question).toBe('Q');
  expect(cur.answer).toContain('A');
  expect(cur.note.id).toBe(cur.card.noteId);
  expect(cur.noteType.id).toBe(cur.note.noteTypeId);
});

test('answer(true) advances; answer(false) keeps the card and counts wrong', async () => {
  for (const q of ['a', 'b', 'c']) await addBasic(deck, q);
  const s = await CramSession.open(deps, deck);
  const [first, second] = s.state().queue;

  expect(await s.answer(true)).toEqual({ saved: true });
  expect(s.state().queue).toHaveLength(2);
  expect(s.state().right).toBe(1);
  expect(s.current()!.card.id).toBe(second);

  expect(await s.answer(false)).toEqual({ saved: true });
  expect(s.state().wrong).toBe(1);
  expect(s.state().queue).toHaveLength(2);
  expect(s.state().queue).toContain(second);
  expect(s.state().queue).not.toContain(first);
});

test('answer with the wrong expectedCardId is ignored', async () => {
  for (const q of ['a', 'b']) await addBasic(deck, q);
  const s = await CramSession.open(deps, deck);
  const before = structuredClone(s.state());
  const [front, other] = s.state().queue;
  expect(await s.answer(true, other)).toBeNull();
  expect(s.state()).toEqual(before);
  expect(await s.answer(true, front)).toEqual({ saved: true });
  expect(s.state().right).toBe(1);
});

test('two answers started without awaiting grade one card only', async () => {
  for (const q of ['a', 'b', 'c']) await addBasic(deck, q);
  const s = await CramSession.open(deps, deck);
  const first = s.answer(true);
  const second = s.answer(true);
  expect(await first).toEqual({ saved: true });
  expect(await second).toBeNull();
  expect(s.state().right).toBe(1);
  expect(s.state().queue).toHaveLength(2);
});

test('undo restores the exact previous state', async () => {
  for (const q of ['a', 'b', 'c', 'd']) await addBasic(deck, q);
  const s = await CramSession.open(deps, deck);
  expect(s.canUndo()).toBe(false);
  expect(await s.undo()).toBeNull();

  const start = structuredClone(s.state());
  await s.answer(false);
  const afterOne = structuredClone(s.state());
  await s.answer(true);
  expect(s.canUndo()).toBe(true);

  expect(await s.undo()).toEqual({ saved: true });
  expect(s.state()).toEqual(afterOne);
  expect(await s.undo()).toEqual({ saved: true });
  expect(s.state()).toEqual(start);
  expect(s.canUndo()).toBe(false);
  expect(s.current()!.card.id).toBe(start.queue[0]);
});

test('a finished round goes again with every eligible card, reshuffled', async () => {
  const ids = [await addBasic(deck, 'a'), await addBasic(deck, 'b'), await addBasic(deck, 'c')];
  await deps.db.execute(`UPDATE cards SET suspended = 1 WHERE id = ?`, [ids[2]]);
  const s = await CramSession.open(deps, deck);
  expect(s.state().pool).toHaveLength(2);
  while (!s.isComplete()) await s.answer(true);
  expect(s.current()).toBeNull();

  await deps.db.execute(`UPDATE cards SET suspended = 0 WHERE id = ?`, [ids[2]]);
  expect(await s.goAgain()).toEqual({ saved: true });
  expect(s.isComplete()).toBe(false);
  expect(s.state().round).toBe(2);
  expect(s.state().right).toBe(0);
  expect(s.state().wrong).toBe(0);
  expect(sorted(s.state().queue)).toEqual(sorted(ids));
  expect(sorted(s.state().pool)).toEqual(sorted(ids));
});

test('restart mid-round gives a fresh round 1 and clears undo', async () => {
  for (const q of ['a', 'b', 'c']) await addBasic(deck, q);
  const s = await CramSession.open(deps, deck);
  await s.goAgain();
  await s.answer(true);
  await s.answer(false);
  expect(s.state().round).toBe(2);

  expect(await s.restart()).toEqual({ saved: true });
  expect(s.state().round).toBe(1);
  expect(s.state().queue).toHaveLength(3);
  expect(s.state().right).toBe(0);
  expect(s.state().wrong).toBe(0);
  expect(s.canUndo()).toBe(false);
});

test('an empty deck is empty and shows no card', async () => {
  const s = await CramSession.open(deps, deck);
  expect(s.isEmpty()).toBe(true);
  expect(s.current()).toBeNull();
  expect(await s.answer(true)).toBeNull();
});

test('a deck with only suspended cards is empty', async () => {
  const id = await addBasic(deck, 'a');
  await deps.db.execute(`UPDATE cards SET suspended = 1 WHERE id = ?`, [id]);
  const s = await CramSession.open(deps, deck);
  expect(s.isEmpty()).toBe(true);
});

test('schedule safety: cards, notes and revlog are untouched by a whole session', async () => {
  for (const q of ['a', 'b', 'c', 'd']) await addBasic(deck, q);
  const rev = await addBasic(deck, 'e');
  await makeReview(deps.db, rev, { dueAt: T0 + 5 * DAY });
  const snap = async () => ({
    cards: await deps.db.query('SELECT * FROM cards ORDER BY id'),
    notes: await deps.db.query('SELECT * FROM notes ORDER BY id'),
    revlog: await deps.db.query('SELECT * FROM revlog ORDER BY id'),
    decks: await deps.db.query('SELECT * FROM decks ORDER BY id'),
    otherMeta: await deps.db.query(`SELECT * FROM meta WHERE key NOT LIKE 'cram:%' ORDER BY key`),
  });
  const before = await snap();

  const s = await CramSession.open(deps, deck);
  let n = 0;
  while (!s.isComplete()) {
    await s.answer(n++ % 3 !== 0);
    if (n === 2) await s.undo();
  }
  await s.goAgain();
  await s.answer(false);
  await s.restart();

  expect(await snap()).toEqual(before);
  // the only thing the session wrote is its own meta row
  expect(await savedRow(deck)).not.toBeNull();
});

/** A Db whose next read of `notes` rejects once after `failNext()`; everything else passes through. */
function flaky(db: CramDeps['db']) {
  let armed = false;
  const wrapped: CramDeps['db'] = {
    query: (sql, params) => {
      if (armed && /FROM notes/.test(sql)) {
        armed = false;
        return Promise.reject(new Error('read failed'));
      }
      return db.query(sql, params);
    },
    execute: (sql, params) => db.execute(sql, params),
    batch: (statements) => db.batch(statements),
  };
  return { db: wrapped, failNext: () => void (armed = true) };
}

async function flakySession() {
  for (const q of ['a', 'b', 'c', 'd']) await addBasic(deck, q);
  const f = flaky(deps.db);
  const s = await CramSession.open({ ...deps, db: f.db }, deck);
  return { s, failNext: f.failNext };
}

test('a failed read during answer leaves the session as it was and releases busy', async () => {
  const { s, failNext } = await flakySession();
  await s.answer(false);
  const state = structuredClone(s.state());
  const front = s.current();

  failNext();
  await expect(s.answer(true)).rejects.toThrow('read failed');
  expect(s.state()).toEqual(state);
  expect(s.current()).toBe(front);
  expect(s.canUndo()).toBe(true);

  expect(await s.answer(true, front!.card.id)).toEqual({ saved: true });
  expect(s.state().right).toBe(1);
  expect(s.current()!.card.id).toBe(s.state().queue[0]);
});

test('a failed read during undo leaves the session as it was and keeps the history', async () => {
  const { s, failNext } = await flakySession();
  await s.answer(true);
  await s.answer(true);
  const state = structuredClone(s.state());
  const front = s.current();

  failNext();
  await expect(s.undo()).rejects.toThrow('read failed');
  expect(s.state()).toEqual(state);
  expect(s.current()).toBe(front);
  expect(s.canUndo()).toBe(true);

  expect(await s.undo()).toEqual({ saved: true });
  expect(await s.undo()).toEqual({ saved: true });
  expect(s.canUndo()).toBe(false);
  expect(s.current()!.card.id).toBe(s.state().queue[0]);
});

test('a failed read during goAgain leaves the session as it was and keeps the history', async () => {
  const { s, failNext } = await flakySession();
  await s.answer(true);
  const state = structuredClone(s.state());
  const front = s.current();

  failNext();
  await expect(s.goAgain()).rejects.toThrow('read failed');
  expect(s.state()).toEqual(state);
  expect(s.current()).toBe(front);
  expect(s.canUndo()).toBe(true);

  expect(await s.goAgain()).toEqual({ saved: true });
  expect(s.state().round).toBe(2);
  expect(s.canUndo()).toBe(false);
  expect(await s.answer(true, s.current()!.card.id)).toEqual({ saved: true });
});

async function savedRow(deckId: number): Promise<string | null> {
  const [row] = await deps.db.query<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [cramKey(deckId)]);
  return row ? row.value : null;
}

async function saved(deckId: number): Promise<unknown> {
  const raw = await savedRow(deckId);
  return raw === null ? null : JSON.parse(raw);
}

const asSaved = (st: ReturnType<CramSession['state']>) => ({ version: 1, deckCreatedAt: T0, ...st });

async function addMany(deckId: number, n: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(await addBasic(deckId, `q${i}`));
  return ids;
}

test('cramKey names the meta row of a deck', () => {
  expect(cramKey(7)).toBe('cram:7');
});

test('nothing is saved on open; each answer and undo saves the current state', async () => {
  await addMany(deck, 4);
  const s = await CramSession.open(deps, deck);
  expect(await savedRow(deck)).toBeNull();

  expect(await s.answer(false)).toEqual({ saved: true });
  expect(await saved(deck)).toEqual(asSaved(s.state()));
  const afterOne = structuredClone(s.state());

  expect(await s.answer(true)).toEqual({ saved: true });
  expect(await saved(deck)).toEqual(asSaved(s.state()));

  expect(await s.undo()).toEqual({ saved: true });
  expect(s.state()).toEqual(afterOne);
  expect(await saved(deck)).toEqual(asSaved(afterOne));
});

test('a second open resumes the same round without reshuffling, whatever the rng', async () => {
  await addMany(deck, 6);
  const first = await CramSession.open(deps, deck);
  await first.goAgain();
  await first.answer(false);
  await first.answer(true);
  await first.answer(false);

  const second = await CramSession.open({ ...deps, rng: mulberry32(999) }, deck);
  expect(second.state()).toEqual(first.state());
  expect(second.current()!.card.id).toBe(first.current()!.card.id);
  expect(second.canUndo()).toBe(false);
});

test('a round that completes deletes the saved row and the next open starts round 1', async () => {
  const ids = await addMany(deck, 3);
  const s = await CramSession.open(deps, deck);
  while (!s.isComplete()) await s.answer(true);
  expect(await savedRow(deck)).toBeNull();

  const again = await CramSession.open(deps, deck);
  expect(again.state().round).toBe(1);
  expect(again.state().right).toBe(0);
  expect(sorted(again.state().queue)).toEqual(sorted(ids));
});

test('resume drops deleted, suspended and moved cards, keeps order, and ignores new cards', async () => {
  const other = await seedDeck(deps.db, 'Physics');
  await addMany(deck, 6);
  const s = await CramSession.open(deps, deck);
  await s.answer(true);
  const before = structuredClone(s.state());
  const [deleted, suspended, moved] = [before.queue[0]!, before.queue[1]!, before.queue[3]!];

  await deps.db.execute(`DELETE FROM cards WHERE id = ?`, [deleted]);
  await deps.db.execute(`UPDATE cards SET suspended = 1 WHERE id = ?`, [suspended]);
  await deps.db.execute(`UPDATE cards SET deck_id = ? WHERE id = ?`, [other, moved]);
  const added = await addBasic(deck, 'new');

  const r = await CramSession.open(deps, deck);
  const gone = new Set([deleted, suspended, moved]);
  expect(r.state().queue).toEqual(before.queue.filter((id) => !gone.has(id)));
  expect(r.state().pool).toEqual(before.pool.filter((id) => !gone.has(id)));
  expect(r.state().queue).not.toContain(added);
  expect(r.state().pool).not.toContain(added);
  expect(r.state().round).toBe(before.round);
  expect(r.state().right).toBe(1);
  expect(r.current()!.card.id).toBe(r.state().queue[0]);
});

test('if every saved card is gone, open starts a fresh round over the current cards', async () => {
  const old = await addMany(deck, 3);
  const s = await CramSession.open(deps, deck);
  await s.goAgain();
  await s.goAgain();
  await s.answer(false);
  for (const id of old) await deps.db.execute(`UPDATE cards SET suspended = 1 WHERE id = ?`, [id]);
  const fresh = [await addBasic(deck, 'x'), await addBasic(deck, 'y')];

  const r = await CramSession.open(deps, deck);
  expect(sorted(r.state().queue)).toEqual(sorted(fresh));
  expect(sorted(r.state().pool)).toEqual(sorted(fresh));
  expect(r.state().round).toBe(4);
  expect(r.state().right).toBe(0);
  expect(r.state().wrong).toBe(0);
});

test('bad saved values start a fresh round and do not throw', async () => {
  const ids = await addMany(deck, 3);
  const [a, b, c] = ids as [number, number, number];
  const good = { version: 1, deckCreatedAt: T0, round: 5, pool: [a, b, c], queue: [a, b], right: 1, wrong: 1 };
  const bad: Record<string, string> = {
    'not json': 'not json{',
    'a bare number': '7',
    'null': 'null',
    'an array': '[]',
    'empty object': '{}',
    'version 2': JSON.stringify({ ...good, version: 2 }),
    'queue id not in pool': JSON.stringify({ ...good, queue: [a, 999] }),
    'duplicate queue ids': JSON.stringify({ ...good, queue: [a, a] }),
    'duplicate pool ids': JSON.stringify({ ...good, pool: [a, a, b, c] }),
    'negative right': JSON.stringify({ ...good, right: -1 }),
    'negative wrong': JSON.stringify({ ...good, wrong: -1 }),
    'fractional count': JSON.stringify({ ...good, right: 1.5 }),
    'round 0': JSON.stringify({ ...good, round: 0 }),
    'non-integer pool id': JSON.stringify({ ...good, pool: [a, b, c + 0.5], queue: [a] }),
    'string id': JSON.stringify({ ...good, pool: [a, b, String(c)], queue: [a] }),
    'missing deckCreatedAt': JSON.stringify({ version: 1, round: 5, pool: [a, b, c], queue: [a, b], right: 1, wrong: 1 }),
    'fractional deckCreatedAt': JSON.stringify({ ...good, deckCreatedAt: T0 + 0.5 }),
    'string deckCreatedAt': JSON.stringify({ ...good, deckCreatedAt: String(T0) }),
    'deckCreatedAt of another deck': JSON.stringify({ ...good, deckCreatedAt: T0 + 1 }),
    'queue not an array': JSON.stringify({ ...good, queue: 'ab' }),
    'missing wrong': JSON.stringify({ version: 1, deckCreatedAt: T0, round: 5, pool: [a, b, c], queue: [a], right: 0 }),
  };
  // the good one does resume, so the table above is really testing the validator
  await deps.db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [cramKey(deck), JSON.stringify(good)]);
  const resumed = await CramSession.open(deps, deck);
  expect(resumed.state()).toEqual({ round: 5, pool: [a, b, c], queue: [a, b], right: 1, wrong: 1 });

  for (const [name, raw] of Object.entries(bad)) {
    await deps.db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [cramKey(deck), raw]);
    const s = await CramSession.open(deps, deck);
    expect(s.state().round, name).toBe(1);
    expect(s.state().right, name).toBe(0);
    expect(s.state().wrong, name).toBe(0);
    expect(sorted(s.state().queue), name).toEqual(sorted(ids));
    expect(sorted(s.state().pool), name).toEqual(sorted(ids));
  }
});

test('two decks keep separate saved rounds', async () => {
  const other = await seedDeck(deps.db, 'Physics');
  await addMany(deck, 3);
  await addMany(other, 4);
  const a = await CramSession.open(deps, deck);
  const b = await CramSession.open(deps, other);
  await a.answer(true);
  await b.goAgain();
  await b.answer(false);

  const a2 = await CramSession.open(deps, deck);
  const b2 = await CramSession.open(deps, other);
  expect(a2.state()).toEqual(a.state());
  expect(b2.state()).toEqual(b.state());
  expect(a2.state().round).toBe(1);
  expect(b2.state().round).toBe(2);
});

test('restart replaces the saved row with a fresh round 1; goAgain saves round + 1', async () => {
  await addMany(deck, 3);
  const s = await CramSession.open(deps, deck);
  await s.answer(true);
  await s.answer(false);

  expect(await s.goAgain()).toEqual({ saved: true });
  expect(await saved(deck)).toEqual({ ...asSaved(s.state()), round: 2 });

  await s.answer(true);
  expect(await s.restart()).toEqual({ saved: true });
  expect(s.state().round).toBe(1);
  expect(await saved(deck)).toEqual(asSaved(s.state()));
  expect(s.state().right).toBe(0);
});

/** A Db whose writes to `meta` reject, so the round cannot be saved; everything else passes through. */
function metaWriteFails(db: CramDeps['db']): CramDeps['db'] {
  return {
    query: (sql, params) => db.query(sql, params),
    execute: (sql, params) =>
      /\bmeta\b/.test(sql) ? Promise.reject(new Error('disk full')) : db.execute(sql, params),
    batch: (statements) => db.batch(statements),
  };
}

test('when the meta write fails, the round still advances in memory and saved is false', async () => {
  await addMany(deck, 4);
  const s = await CramSession.open({ ...deps, db: metaWriteFails(deps.db) }, deck);
  const start = structuredClone(s.state());

  expect(await s.answer(false)).toEqual({ saved: false });
  expect(s.state().wrong).toBe(1);
  expect(s.state().queue).toHaveLength(4);
  expect(s.current()!.card.id).toBe(s.state().queue[0]);
  expect(await s.answer(true)).toEqual({ saved: false });
  expect(s.state().right).toBe(1);

  expect(await s.undo()).toEqual({ saved: false });
  expect(s.state().right).toBe(0);
  expect(await s.undo()).toEqual({ saved: false });
  expect(s.state()).toEqual(start);

  expect(await s.goAgain()).toEqual({ saved: false });
  expect(s.state().round).toBe(2);
  expect(await s.restart()).toEqual({ saved: false });
  expect(s.state().round).toBe(1);
  expect(await savedRow(deck)).toBeNull();
});

test('a failed delete of the saved row when the round completes also reports saved: false', async () => {
  await addMany(deck, 1);
  const s = await CramSession.open(deps, deck);
  await s.answer(false);
  expect(await savedRow(deck)).not.toBeNull();

  const s2 = await CramSession.open({ ...deps, db: metaWriteFails(deps.db) }, deck);
  expect(await s2.answer(true)).toEqual({ saved: false });
  expect(s2.isComplete()).toBe(true);
});

test('a saved round of a deleted deck is not resumed by a new deck that reuses its id', async () => {
  await addMany(deck, 6);
  const old = await CramSession.open(deps, deck);
  await old.answer(true);
  await old.answer(false);
  await old.answer(true);
  expect(await savedRow(deck)).not.toBeNull();

  await deleteDeck(deps.db, deck);
  const reused = await createDeck(deps.db, { name: 'Biology' }, T0 + DAY);
  expect(reused).toBe(deck);
  const ids = await addMany(reused, 10);

  const s = await CramSession.open(deps, reused);
  expect(s.state().round).toBe(1);
  expect(s.state().right).toBe(0);
  expect(s.state().wrong).toBe(0);
  expect(sorted(s.state().pool)).toEqual(sorted(ids));
  expect(sorted(s.state().queue)).toEqual(sorted(ids));
});

test('two overlapping goAgain calls reshuffle once', async () => {
  await addMany(deck, 3);
  const s = await CramSession.open(deps, deck);
  const first = s.goAgain();
  const second = s.goAgain();
  expect(await first).toEqual({ saved: true });
  expect(await second).toEqual({ saved: true });
  expect(s.state().round).toBe(2);
  expect(await saved(deck)).toEqual(asSaved(s.state()));
  // the flag was released by the call that took it, so the session still works
  expect(await s.answer(true)).toEqual({ saved: true });
});

test('undo after the round completed restores the last card and saves the row again', async () => {
  await addMany(deck, 2);
  const s = await CramSession.open(deps, deck);
  await s.answer(true);
  const lastCard = s.current()!.card.id;
  const beforeLast = structuredClone(s.state());
  await s.answer(true);
  expect(s.isComplete()).toBe(true);
  expect(await savedRow(deck)).toBeNull();

  expect(await s.undo()).toEqual({ saved: true });
  expect(s.isComplete()).toBe(false);
  expect(s.state()).toEqual(beforeLast);
  expect(s.current()!.card.id).toBe(lastCard);
  expect(await saved(deck)).toEqual(asSaved(s.state()));
});

test('goAgain clears the undo history after an answered round', async () => {
  await addMany(deck, 2);
  const s = await CramSession.open(deps, deck);
  while (!s.isComplete()) await s.answer(true);
  expect(s.canUndo()).toBe(true);
  await s.goAgain();
  expect(s.canUndo()).toBe(false);
  expect(await s.undo()).toBeNull();
});
