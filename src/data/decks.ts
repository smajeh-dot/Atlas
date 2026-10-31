import { descendantIds } from '../core/deckTree';
import type { Deck } from '../core/model';
import type { Db, Statement } from './db';
import { toDeck } from './rows';

export class DeckNameError extends Error {}
export class DeckMoveError extends Error {}

const DECK_COLOURS = 8;

export async function listDecks(db: Db): Promise<Deck[]> {
  return (await db.query(`SELECT * FROM decks ORDER BY position, id`)).map(toDeck);
}

async function checkName(db: Db, name: string, parentId: number | null, exceptId?: number): Promise<string> {
  const clean = name.trim();
  if (!clean) throw new DeckNameError('Give the deck a name.');
  // "::" is how Anki writes deck paths, so it would break imports and exports.
  if (clean.includes('::')) throw new DeckNameError('Deck names cannot contain "::".');
  const siblings = (await listDecks(db)).filter((d) => d.parentId === parentId && d.id !== exceptId);
  if (siblings.some((d) => d.name.toLowerCase() === clean.toLowerCase())) {
    throw new DeckNameError(`There is already a deck called "${clean}" here.`);
  }
  return clean;
}

function nextColour(decks: Deck[]): number {
  const used = new Set(decks.filter((d) => d.parentId === null).map((d) => d.colour));
  for (let c = 1; c <= DECK_COLOURS; c++) if (!used.has(c)) return c;
  return (decks.filter((d) => d.parentId === null).length % DECK_COLOURS) + 1;
}

export async function createDeck(
  db: Db,
  input: { name: string; parentId?: number | null; presetId?: number },
  now: number,
): Promise<number> {
  const parentId = input.parentId ?? null;
  const name = await checkName(db, input.name, parentId);
  const decks = await listDecks(db);
  const siblings = decks.filter((d) => d.parentId === parentId);
  const position = siblings.reduce((m, d) => Math.max(m, d.position), -1) + 1;
  const r = await db.execute(
    `INSERT INTO decks (name, parent_id, preset_id, colour, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, parentId, input.presetId ?? 1, parentId === null ? nextColour(decks) : null, position, now],
  );
  return r.lastInsertId;
}

async function getDeck(db: Db, id: number): Promise<Deck> {
  const [row] = await db.query(`SELECT * FROM decks WHERE id = ?`, [id]);
  if (!row) throw new Error(`Deck ${id} does not exist`);
  return toDeck(row);
}

export async function renameDeck(db: Db, id: number, name: string): Promise<void> {
  const deck = await getDeck(db, id);
  await db.execute(`UPDATE decks SET name = ? WHERE id = ?`, [await checkName(db, name, deck.parentId, id), id]);
}

export async function moveDeck(db: Db, id: number, parentId: number | null): Promise<void> {
  const decks = await listDecks(db);
  if (parentId !== null && descendantIds(decks, id).includes(parentId)) {
    throw new DeckMoveError('A deck cannot go inside itself or one of its own subdecks.');
  }
  const deck = await getDeck(db, id);
  await checkName(db, deck.name, parentId, id);
  const position = decks.filter((d) => d.parentId === parentId).reduce((m, d) => Math.max(m, d.position), -1) + 1;
  await db.execute(`UPDATE decks SET parent_id = ?, position = ? WHERE id = ?`, [parentId, position, id]);
}

export async function setDeckPreset(db: Db, id: number, presetId: number): Promise<void> {
  await db.execute(`UPDATE decks SET preset_id = ? WHERE id = ?`, [presetId, id]);
}

export async function setDeckCollapsed(db: Db, id: number, collapsed: boolean): Promise<void> {
  await db.execute(`UPDATE decks SET collapsed = ? WHERE id = ?`, [collapsed ? 1 : 0, id]);
}

/** Deletes the deck, its subdecks and their cards; notes are deleted only when no card of theirs is left. */
export async function deleteDeck(db: Db, id: number): Promise<{ deletedCards: number; deletedNotes: number }> {
  // Only deck ids are bound as parameters; note and card ids stay inside subqueries,
  // so a deck with tens of thousands of notes never hits SQLite's parameter limit.
  const ids = descendantIds(await listDecks(db), id);
  const sub = `(${ids.map(() => '?').join(',')})`;
  const onlyHere = `id IN (SELECT note_id FROM cards WHERE deck_id IN ${sub})
    AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.note_id = notes.id AND c.deck_id NOT IN ${sub})`;
  const [cards] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM cards WHERE deck_id IN ${sub}`, ids);
  const [notes] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM notes WHERE ${onlyHere}`, [...ids, ...ids]);
  await db.batch([
    { sql: `DELETE FROM notes WHERE ${onlyHere}`, params: [...ids, ...ids] },
    { sql: `DELETE FROM cards WHERE deck_id IN ${sub}`, params: ids },
    { sql: `DELETE FROM decks WHERE id = ?`, params: [id] },
  ]);
  return { deletedCards: Number(cards?.n ?? 0), deletedNotes: Number(notes?.n ?? 0) };
}

/**
 * Puts a deck under `parentId` at sibling position `index` (clamped), renumbering that parent's
 * children 0…n−1. Nested decks lose their colour; a deck that becomes top-level gets the next free one.
 */
export async function placeDeck(db: Db, id: number, parentId: number | null, index: number): Promise<void> {
  const decks = await listDecks(db);
  if (parentId !== null && descendantIds(decks, id).includes(parentId)) {
    throw new DeckMoveError('A deck cannot go inside itself or one of its own subdecks.');
  }
  const deck = await getDeck(db, id);
  await checkName(db, deck.name, parentId, id);
  const siblings = decks
    .filter((d) => d.parentId === parentId && d.id !== id)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const at = Math.max(0, Math.min(Math.trunc(index), siblings.length));
  const ordered = [...siblings.slice(0, at).map((d) => d.id), id, ...siblings.slice(at).map((d) => d.id)];
  const others = decks.filter((d) => d.id !== id);
  const colour = parentId !== null ? null : deck.parentId === null ? deck.colour : nextColour(others);
  const statements: Statement[] = [{ sql: `UPDATE decks SET parent_id = ?, colour = ? WHERE id = ?`, params: [parentId, colour, id] }];
  ordered.forEach((deckId, position) => statements.push({ sql: `UPDATE decks SET position = ? WHERE id = ?`, params: [position, deckId] }));
  await db.batch(statements);
}

export async function setDeckColour(db: Db, id: number, colour: number): Promise<void> {
  if (!Number.isInteger(colour) || colour < 1 || colour > DECK_COLOURS) throw new Error(`Deck colour ${colour} is not 1-${DECK_COLOURS}`);
  const deck = await getDeck(db, id);
  if (deck.parentId !== null) throw new DeckMoveError('Only top-level decks have a colour.');
  await db.execute(`UPDATE decks SET colour = ? WHERE id = ?`, [colour, id]);
}

/** What deleting a deck would remove, for the confirmation message. */
export async function deckDeletionSummary(db: Db, id: number): Promise<{ subdecks: number; cards: number }> {
  const ids = descendantIds(await listDecks(db), id);
  const [r] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM cards WHERE deck_id IN (${ids.map(() => '?').join(',')})`, ids);
  return { subdecks: ids.length - 1, cards: Number(r?.n ?? 0) };
}
