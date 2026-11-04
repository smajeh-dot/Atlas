/**
 * Converts between stored field HTML (Anki style: inline HTML with <br>, equations as \( \) and \[ \])
 * and the HTML the editor works with (paragraphs, equations as math spans).
 */

const INLINE = /\\\(([\s\S]*?)\\\)/g;
const DISPLAY = /\\\[([\s\S]*?)\\\]/g;
const MATH_SPAN = /<span data-math="(inline|display)">([\s\S]*?)<\/span>/g;
const ONLY_PARAGRAPHS = /^(<p>[\s\S]*?<\/p>)+$/;

export function toEditorHtml(field: string): string {
  return field
    .replace(DISPLAY, (_m, tex: string) => `<span data-math="display">${tex}</span>`)
    .replace(INLINE, (_m, tex: string) => `<span data-math="inline">${tex}</span>`);
}

export function fromEditorHtml(html: string): string {
  let out = html.replace(MATH_SPAN, (_m, kind: string, tex: string) => (kind === 'display' ? `\\[${tex}\\]` : `\\(${tex}\\)`));
  // Paragraphs become line breaks so a one-line field stays plain inline HTML, as Anki stores it.
  if (ONLY_PARAGRAPHS.test(out)) {
    const parts = [...out.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]!);
    out = parts.join('<br>');
    if (parts.every((p) => p === '')) out = '';
  }
  return out;
}
