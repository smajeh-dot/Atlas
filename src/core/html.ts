import { findMath } from './math';

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** Plain text of a field: used for sorting, searching and duplicate checks. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(div|p|li|tr|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Makes plain text safe to place inside HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

const BLOCK = /<(div|p|ul|ol|li|table|pre|blockquote|h[1-6]|hr|details|br)\b/i;

/** Roughly how wide an inline equation reads, whatever the length of its TeX. */
const INLINE_MATH_CHARS = 6;

/**
 * Short enough, and simple enough, to show in the large display font (spec 10.4).
 * Inline equations are allowed and count as a few characters; a display equation makes it long.
 */
export function isShortHtml(html: string, maxChars: number): boolean {
  const maths = findMath(html);
  if (maths.some((m) => m.kind === 'display')) return false;
  let text = '';
  let pos = 0;
  for (const m of maths) {
    text += html.slice(pos, m.start) + 'x'.repeat(INLINE_MATH_CHARS);
    pos = m.end;
  }
  text += html.slice(pos);
  return stripHtml(text).length <= maxChars && !/<img\b/i.test(html) && !BLOCK.test(text);
}
