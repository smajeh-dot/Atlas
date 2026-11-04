/**
 * Turns one chunk of staged Anki notes into Atlas rows. Pure: no database,
 * no clock, no randomness; everything it needs is in the context, so the same
 * staging data and context always give the same rows.
 *
 * - A note whose guid Atlas already has is never touched (its progress
 *   wins), except that cards it lacks are added, and with `updateExisting`
 *   its text and tags are refreshed. Scheduling is never replaced.
 * - Cards keep Anki's ord. A card with no template or cloze to show is
 *   skipped, with its reviews, and counted.
 * - Every review becomes an Atlas review with the same id (the answer time),
 *   moved by 1 ms only if that id is already taken.
 */
import { cardOrdsForNote } from '../core/cards';
import { stripHtml } from '../core/html';
import type { Card, Note, NoteType, RevlogEntry } from '../core/model';
import { normaliseTags } from '../data/notes';
import type { DeckPlan, IdSource } from './decks';
import { mediaKey, mediaReferences, rewriteReferences } from './media';
import type { NoteTypePlan } from './noteTypes';
import type { ReportBuilder } from './report';
import { convertCard } from './schedule';
import type { Chunk, SCard, SNote } from './staging';

export interface ExistingNote {
  id: number;
  noteTypeId: number;
  fields: string[];
  tags: string[];
  ords: Set<number>;
}

/** Hands out review ids: Anki's answer time, bumped past any id already used. */
export class RevlogIds {
  constructor(private readonly taken: Set<number>) {}

  take(id: number): number {
    let n = Math.round(id);
    while (this.taken.has(n)) n++;
    this.taken.add(n);
    return n;
  }
}

export interface PlanContext {
  now: number;
  dayStartHour: number;
  ankiToday: number;
  decks: DeckPlan;
  types: NoteTypePlan;
  /** Learning and relearning step counts for a card, from its Anki home deck and Atlas deck. */
  stepsFor(ankiHomeDeckId: number, atlasDeckId: number): { learn: number; relearn: number };
  /** Notes Atlas already has, by guid. Notes created by this import are added as it goes. */
  existing: Map<string, ExistingNote>;
  noteIds: IdSource;
  cardIds: IdSource;
  revlogIds: RevlogIds;
  /** Added to Anki's new-card positions so imported new cards queue after Atlas's own. */
  newPositionBase: number;
  media: { renames: Map<string, string>; known: Set<string> };
  /** Missing media names already reported, so each is counted once. */
  missingSeen: Set<string>;
  updateExisting: boolean;
}

export interface ChunkPlan {
  notes: Note[];
  noteUpdates: Note[];
  cards: Card[];
  revlog: RevlogEntry[];
}

const SOUND = /\[sound:[^\]]+\]/i;
const LATEX = /\[latex\]|\[\$\$?\]|\\\(|\\\[/i;
const ACTIVE = /<script\b|<iframe\b|<object\b|<embed\b|javascript:|<[^>]*\son[a-z]+\s*=/i;

/** Fits a note's fields to its type: pads with blanks; extra fields are kept, joined onto the last. */
function fitFields(fields: string[], count: number): { fields: string[]; changed: boolean } {
  if (fields.length === count) return { fields, changed: false };
  if (fields.length < count) return { fields: [...fields, ...Array<string>(count - fields.length).fill('')], changed: true };
  if (count === 0) return { fields: [], changed: true };
  const kept = fields.slice(0, count - 1);
  const rest = fields.slice(count - 1).filter((f) => f !== '');
  return { fields: [...kept, rest.join('<br>')], changed: true };
}

function cardHasContent(type: NoteType, fields: string[], ord: number, clozeOrds: () => Set<number>): boolean {
  if (type.kind === 'cloze') return clozeOrds().has(ord);
  return ord >= 0 && ord < type.templates.length;
}

function scanNote(note: SNote, fields: string[], ctx: PlanContext, report: ReportBuilder): void {
  const all = fields.join('\n');
  const label = stripHtml(fields[0] ?? '').slice(0, 60) || note.guid;
  if (SOUND.test(all)) report.warn('sound', label);
  if (LATEX.test(all)) report.warn('latex', label);
  if (ACTIVE.test(all)) report.warn('active-content', label);
  for (const ref of mediaReferences(all)) {
    const key = mediaKey(ref);
    if (!ctx.media.known.has(key) && !ctx.missingSeen.has(key)) {
      ctx.missingSeen.add(key);
      report.warn('missing-media', ref);
    }
  }
}

export function planChunk(chunk: Chunk, ctx: PlanContext, report: ReportBuilder): ChunkPlan {
  const out: ChunkPlan = { notes: [], noteUpdates: [], cards: [], revlog: [] };
  const cardsByNote = new Map<number, SCard[]>();
  for (const c of chunk.cards) cardsByNote.set(c.noteId, [...(cardsByNote.get(c.noteId) ?? []), c]);
  const reviewsByCard = new Map<number, typeof chunk.revlog>();
  for (const r of chunk.revlog) reviewsByCard.set(r.cardId, [...(reviewsByCard.get(r.cardId) ?? []), r]);

  for (const sn of chunk.notes) {
    const ankiCards = cardsByNote.get(sn.id) ?? [];
    const type = ctx.types.typeFor.get(sn.notetypeId);
    if (!type) {
      // The file names a note type it doesn't contain; nothing can be shown.
      report.skipped.cardsWithNoContent += ankiCards.length;
      for (const c of ankiCards) report.skipped.reviewsForSkippedCards += reviewsByCard.get(c.id)?.length ?? 0;
      continue;
    }
    const fitted = fitFields(sn.fields.map((f) => rewriteReferences(f, ctx.media.renames)), type.fields.length);
    const tags = normaliseTags(sn.tags);
    const existing = ctx.existing.get(sn.guid);

    let clozeCache: Set<number> | undefined;
    const clozeOrds = () => (clozeCache ??= new Set(cardOrdsForNote(type, fitted.fields)));
    const noteId = existing?.id ?? ctx.noteIds.next();
    const have = new Set(existing?.ords ?? []);
    const cards: Card[] = [];
    const revlog: RevlogEntry[] = [];
    for (const c of ankiCards) {
      const reviews = reviewsByCard.get(c.id) ?? [];
      if (have.has(c.ord)) continue; // Atlas already has this card: its progress wins.
      if (!cardHasContent(type, fitted.fields, c.ord, clozeOrds)) {
        report.skipped.cardsWithNoContent++;
        report.skipped.reviewsForSkippedCards += reviews.length;
        continue;
      }
      have.add(c.ord);
      const home = c.origDeckId !== 0 ? c.origDeckId : c.deckId;
      const deckId = ctx.decks.deckFor.get(home)!;
      const steps = ctx.stepsFor(home, deckId);
      const conv = convertCard(c, reviews, {
        ankiToday: ctx.ankiToday,
        now: ctx.now,
        dayStartHour: ctx.dayStartHour,
        learnSteps: steps.learn,
        relearnSteps: steps.relearn,
      });
      if (conv.memory === 'estimated') report.estimated++;
      if (conv.diverged) report.diverged++;
      const id = ctx.cardIds.next();
      cards.push({
        id, noteId, ord: c.ord, deckId, originalDeckId: null, ...conv.card,
        newPosition: conv.card.newPosition === null ? null : ctx.newPositionBase + conv.card.newPosition,
        buriedDay: null, buriedKind: null, createdAt: c.id, updatedAt: ctx.now,
      });
      for (const v of conv.revlog) revlog.push({ ...v, id: ctx.revlogIds.take(v.id), cardId: id });
    }

    if (existing) {
      report.skipped.existingNotes++;
      existing.ords = have;
      if (ctx.updateExisting && existing.noteTypeId === type.id) {
        const changed = JSON.stringify(existing.fields) !== JSON.stringify(fitted.fields) ||
          JSON.stringify(existing.tags) !== JSON.stringify(tags);
        if (changed) {
          out.noteUpdates.push({
            id: existing.id, guid: sn.guid, noteTypeId: type.id, fields: fitted.fields,
            sortField: stripHtml(fitted.fields[0] ?? ''), tags, createdAt: sn.id, updatedAt: ctx.now,
          });
          existing.fields = fitted.fields;
          existing.tags = tags;
          report.updatedNotes++;
        }
      }
    } else {
      if (!cards.length) continue; // Every card was empty: there's nothing to study.
      out.notes.push({
        id: noteId, guid: sn.guid, noteTypeId: type.id, fields: fitted.fields, sortField: stripHtml(fitted.fields[0] ?? ''),
        tags, createdAt: sn.id, updatedAt: sn.modSecs * 1000,
      });
      ctx.existing.set(sn.guid, { id: noteId, noteTypeId: type.id, fields: fitted.fields, tags, ords: have });
      report.imported.notes++;
      if (fitted.changed) report.warn('field-count', stripHtml(fitted.fields[0] ?? '').slice(0, 60));
      if (tags.length !== sn.tags.length || tags.some((t, i) => t !== sn.tags[i])) report.warn('renamed-tags', sn.tags.join(' '));
      if (ctx.types.imageOcclusion.has(sn.notetypeId)) report.warn('image-occlusion', stripHtml(fitted.fields[2] ?? '') || sn.guid);
      scanNote(sn, fitted.fields, ctx, report);
    }
    out.cards.push(...cards);
    out.revlog.push(...revlog);
    report.imported.cards += cards.length;
    report.imported.reviews += revlog.length;
  }
  return out;
}
