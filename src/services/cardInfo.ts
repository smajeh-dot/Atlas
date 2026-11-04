import { fullName } from '../core/deckTree';
import { getCard } from '../data/cards';
import type { Db } from '../data/db';
import { listDecks } from '../data/decks';
import { getNoteType } from '../data/noteTypes';
import { getNote } from '../data/notes';

export interface CardInfo {
  cardId: number;
  added: number;
  firstReview: number | null;
  latestReview: number | null;
  due: number | null;
  intervalDays: number;
  stability: number;
  difficulty: number;
  reviews: number;
  lapses: number;
  averageMs: number | null;
  deckName: string;
  noteTypeName: string;
  cardName: string;
}

export async function getCardInfo(db: Db, cardId: number): Promise<CardInfo> {
  const card = await getCard(db, cardId);
  const note = await getNote(db, card.noteId);
  const noteType = await getNoteType(db, note.noteTypeId);
  const [log] = await db.query<{ first: number | null; latest: number | null; n: number; avg: number | null }>(
    `SELECT MIN(id) AS first, MAX(id) AS latest, COUNT(*) AS n, AVG(duration_ms) AS avg FROM revlog WHERE card_id = ? AND rating > 0`,
    [cardId],
  );
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    cardId,
    added: card.createdAt,
    firstReview: num(log?.first),
    latestReview: num(log?.latest),
    due: card.dueAt,
    intervalDays: card.scheduledDays,
    stability: card.stability,
    difficulty: card.difficulty,
    reviews: Number(log?.n ?? 0),
    lapses: card.lapses,
    averageMs: num(log?.avg),
    deckName: fullName(await listDecks(db), card.deckId),
    noteTypeName: noteType.name,
    cardName: noteType.kind === 'cloze' ? `Cloze ${card.ord + 1}` : (noteType.templates[card.ord]?.name ?? `Card ${card.ord + 1}`),
  };
}
