import { renderCloze } from './cloze';
import { escapeHtml, stripHtml } from './html';
import type { Note, NoteType } from './model';

export interface TemplateContext {
  fields: Record<string, string>;
  tags: string[];
  deckName: string;
  subdeckName: string;
  cardName: string;
  noteTypeName: string;
  side: 'front' | 'back';
  frontSide?: string;
  clozeOrd?: number;
}

/** Stands in for Anki's <hr id=answer>; the study screen draws its own divider here. */
export const ANSWER_MARKER = '<!--atlas:answer-->';

const SECTION = /\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;
const TAG = /\{\{\s*([^}]+?)\s*\}\}/g;
const KNOWN_FILTERS = new Set(['cloze', 'type', 'text', 'hint']);

export function hasContent(html: string): boolean {
  return stripHtml(html) !== '' || /<img\b/i.test(html);
}

function special(name: string, ctx: TemplateContext): string | undefined {
  switch (name) {
    case 'FrontSide': return ctx.frontSide ?? '';
    case 'Tags': return ctx.tags.join(' ');
    case 'Deck': return ctx.deckName;
    case 'Subdeck': return ctx.subdeckName;
    case 'Card': return ctx.cardName;
    case 'Type': return ctx.noteTypeName;
    default: return undefined;
  }
}

export function renderTemplate(template: string, ctx: TemplateContext): { html: string; unknownFilters: string[] } {
  const unknownFilters: string[] = [];
  let html = template;
  for (let m = SECTION.exec(html); m; m = SECTION.exec(html)) {
    const filled = hasContent(ctx.fields[m[2]!] ?? '');
    const show = m[1] === '#' ? filled : !filled;
    html = html.slice(0, m.index) + (show ? m[3] : '') + html.slice(m.index + m[0].length);
  }
  html = html.replace(TAG, (_all, inner: string) => {
    const parts = inner.split(':');
    const name = parts.pop()!.trim();
    const own = special(name, ctx);
    if (own !== undefined && parts.length === 0) return own;
    let value = ctx.fields[name] ?? '';
    for (const filter of parts.reverse().map((f) => f.trim())) {
      if (filter === 'cloze') value = renderCloze(value, ctx.clozeOrd ?? 1, ctx.side);
      // stripHtml decodes entities; re-escape so "&lt;b&gt;" stays text instead of becoming live markup.
      else if (filter === 'text') value = escapeHtml(stripHtml(value));
      else if (filter === 'hint') value = !hasContent(value) ? '' : `<details class="atlas-hint"><summary>Show hint</summary>${value}</details>`;
      else if (filter === 'type') {
        value = ctx.side === 'front'
          ? `<input class="atlas-typein" data-field="${name}">`
          : `<div class="atlas-typein-result" data-field="${name}"></div>`;
      } else if (!KNOWN_FILTERS.has(filter)) unknownFilters.push(filter);
    }
    return value;
  });
  return { html, unknownFilters };
}

function fieldMap(noteType: NoteType, note: Note): Record<string, string> {
  const map: Record<string, string> = {};
  noteType.fields.forEach((f, i) => (map[f.name] = note.fields[i] ?? ''));
  return map;
}

export function renderCard(
  noteType: NoteType,
  note: Note,
  ord: number,
  deckFullName: string, // "::"-separated like Anki, e.g. "Biology::Genetics"
): { question: string; answer: string; unknownFilters: string[] } {
  const isCloze = noteType.kind === 'cloze';
  const template = isCloze ? noteType.templates[0] : noteType.templates[ord];
  if (!template) throw new Error(`Note type "${noteType.name}" has no template ${ord + 1}`);
  const base = {
    fields: fieldMap(noteType, note),
    tags: note.tags,
    deckName: deckFullName,
    subdeckName: deckFullName.split('::').pop() ?? deckFullName,
    cardName: isCloze ? `Cloze ${ord + 1}` : template.name,
    noteTypeName: noteType.name,
    ...(isCloze ? { clozeOrd: ord + 1 } : {}),
  };
  const q = renderTemplate(template.front, { ...base, side: 'front' });
  const a = renderTemplate(template.back, { ...base, side: 'back', frontSide: q.html });
  return {
    question: q.html,
    answer: a.html.replace(/<hr\s+id\s*=\s*["']?answer["']?\s*\/?>/i, ANSWER_MARKER),
    unknownFilters: [...new Set([...q.unknownFilters, ...a.unknownFilters])],
  };
}
