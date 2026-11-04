/**
 * Maps Anki note types onto Atlas note types. Pure: ids come from the caller.
 *
 * In order: reuse an Atlas type with exactly the same structure (fields,
 * templates, CSS); else reuse a built-in with the same fields and templates
 * (ignoring whitespace and CSS, which differ only cosmetically); else create
 * one, renamed "<Name> (imported)" if the name is already taken.
 */
import type { NoteType } from '../core/model';
import { renderTemplate } from '../core/templates';
import type { IdSource } from './decks';
import type { ReportBuilder } from './report';
import type { SNoteType } from './staging';

/** Anki's StockNotetype.OriginalStockKind for Image Occlusion. */
const IMAGE_OCCLUSION = 6;

export interface NoteTypePlan {
  /** Anki note type id → the Atlas note type its notes will use. */
  typeFor: Map<number, NoteType>;
  create: NoteType[];
  /** Anki note type ids that are Image Occlusion, so the report can count their notes. */
  imageOcclusion: Set<number>;
}

export function toAtlasShape(t: SNoteType): Omit<NoteType, 'id'> {
  return {
    name: t.name.trim() || 'Imported',
    kind: t.kind,
    builtin: null,
    fields: t.fields.map((name) => ({ name })),
    templates: t.templates.map((x) => ({ name: x.name, front: x.qfmt, back: x.afmt })),
    css: t.css,
  };
}

/** Everything that changes how a card looks, except names. */
function exact(t: Omit<NoteType, 'id'>): string {
  return JSON.stringify([t.kind, t.fields.map((f) => f.name), t.templates.map((x) => [x.front, x.back]), t.css]);
}

/** Structure only: Anki's stock templates differ from Atlas's built-ins by line breaks. */
function loose(t: Omit<NoteType, 'id'>): string {
  const squash = (s: string) => s.replace(/\s+/g, '');
  return JSON.stringify([t.kind, t.fields.map((f) => f.name), t.templates.map((x) => [squash(x.front), squash(x.back)])]);
}

function uniqueName(base: string, taken: NoteType[]): { name: string; renamed: boolean } {
  const lower = new Set(taken.map((t) => t.name.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return { name: base, renamed: false };
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base} (imported)` : `${base} (imported ${i})`;
    if (!lower.has(name.toLowerCase())) return { name, renamed: true };
  }
}

/** Filters a template uses that the Atlas renderer doesn't understand. */
export function unknownFilters(t: Omit<NoteType, 'id'>): string[] {
  const fields = Object.fromEntries(t.fields.map((f) => [f.name, 'x']));
  const ctx = { fields, tags: [], deckName: '', subdeckName: '', cardName: '', noteTypeName: t.name };
  const found = new Set<string>();
  for (const tmpl of t.templates) {
    for (const side of [tmpl.front, tmpl.back]) {
      for (const f of renderTemplate(side, { ...ctx, side: 'front' }).unknownFilters) found.add(f);
    }
  }
  return [...found];
}

export function planNoteTypes(
  types: SNoteType[],
  existing: NoteType[],
  ids: IdSource,
  report: ReportBuilder,
): NoteTypePlan {
  const known: NoteType[] = [...existing];
  const plan: NoteTypePlan = { typeFor: new Map(), create: [], imageOcclusion: new Set() };
  for (const t of types) {
    const shape = toAtlasShape(t);
    if (t.originalStockKind === IMAGE_OCCLUSION) {
      // Kept as a cloze type so every card and its history survive; only the masks can't be drawn yet.
      plan.imageOcclusion.add(t.id);
    }
    const same = known.find((k) => exact(k) === exact(shape));
    const builtin = same ?? known.find((k) => k.builtin !== null && loose(k) === loose(shape));
    if (builtin) {
      plan.typeFor.set(t.id, builtin);
      continue;
    }
    const { name, renamed } = uniqueName(shape.name, known);
    if (renamed) report.warn('renamed-note-type', `${shape.name} → ${name}`);
    const created: NoteType = { ...shape, name, id: ids.next() };
    const filters = unknownFilters(created);
    if (filters.length) report.warn('unknown-filter', `${name}: ${filters.map((f) => `{{${f}:…}}`).join(', ')}`);
    known.push(created);
    plan.create.push(created);
    plan.typeFor.set(t.id, created);
  }
  return plan;
}
