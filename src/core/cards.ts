import { clozeNumbers } from './cloze';
import type { NoteType } from './model';
import { hasContent, renderTemplate } from './templates';

const TYPEIN = /<input class="atlas-typein"[^>]*>/g;

/** Which cards (template index, or cloze number − 1) a note's fields produce. */
export function cardOrdsForNote(noteType: NoteType, fields: string[]): number[] {
  const map: Record<string, string> = {};
  noteType.fields.forEach((f, i) => (map[f.name] = fields[i] ?? ''));
  if (noteType.kind === 'cloze') {
    const src = noteType.templates[0]?.front.match(/\{\{\s*cloze:\s*([^}]+?)\s*\}\}/);
    return src ? clozeNumbers(map[src[1]!] ?? '').map((n) => n - 1) : [];
  }
  const ctx = { fields: map, tags: [], deckName: '', subdeckName: '', cardName: '', noteTypeName: noteType.name, side: 'front' as const };
  return noteType.templates
    .map((t, i) => (hasContent(renderTemplate(t.front, ctx).html.replace(TYPEIN, '')) ? i : -1))
    .filter((i) => i >= 0);
}
